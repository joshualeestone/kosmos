'use strict';

/**
 * Board authentication for the loopback bind (kosmos#1946).
 *
 * The board binds 127.0.0.1, which is machine-local, NOT account-local: every
 * macOS user on the machine shares that interface. The write surface behind it
 * (`POST /api/agents` installs a launchd job running Claude with
 * `--dangerously-skip-permissions`; `POST /api/project/:id/thread/:agent` types
 * into a live agent) is gated only by `isLoopbackPeer` in server.js, which reads
 * the socket peer address and cannot tell WHICH macOS user owns the connecting
 * process. So a second account on the same Mac connects from 127.0.0.1, passes
 * that gate with no credential, and gets code execution as the first user. The
 * product has already observed the read half: #910 documents account B's board
 * loading account A's real agents over the shared loopback.
 *
 * 🔑 THE BOUNDARY MACOS ACTUALLY ENFORCES PER ACCOUNT IS THE FILESYSTEM, NOT
 * LOOPBACK. So the board generates a random token at boot, writes it mode-600 in
 * a mode-700 dir, and requires it on every request. Another account reaches the
 * port but cannot read the token file. A per-account PORT (#910) is not a
 * boundary: the port is a deterministic function of uid, uid is world-readable
 * via `dscl`, and the window is scannable. #910 stopped ACCIDENTAL bleed and was
 * never a control against a deliberate one.
 *
 * 🔑 ENFORCED ONLY WHEN THE BOARD IS NOT FULLY SANDBOXED. `engine/sandbox.js`'s
 * boot audit means a running board is EITHER fully-live (prod) OR fully-sandboxed
 * (a test / browser-check fixture), never partial. A fully-sandboxed board holds
 * no real user data and no attacker cares about it, so leaving it unauthenticated
 * is safe -- and it means the whole test + browser-check suite needs no token and
 * no change. This is NOT a naive fail-open: the disable is gated on the board
 * having ALL of its real data / launch / workers / projects redirected and tmux
 * stubbed, which the real installer provably never does. The guard is decided at
 * the victim board's OWN boot, from the victim's OWN (non-sandboxed) env, so an
 * attacker cannot set the sandbox env on a board that is already protecting real
 * data.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const sandbox = require('./sandbox');
const store = require('./store');

const TOKEN_FILE = 'board.token';
const COOKIE_NAME = 'kosmos_board';
const HEADER_NAME = 'x-kosmos-board-token';

/**
 * A board is fully sandboxed exactly when `sandbox.audit` finds nothing live --
 * all four data dirs redirected AND tmux inert (the audit pushes a synthetic
 * `tmux` entry into `live` when TMUX_BIN is unset, so `live.length === 0` already
 * folds the tmux check in). A prod board sets none of these, so `live` carries
 * every surface and this is false. A half-sandbox override (HALF_SANDBOX_OK) that
 * leaves a surface live is NOT fully sandboxed, so it stays enforced -- the safe
 * direction.
 */
function fullySandboxed(env) {
  return sandbox.audit(env || {}).live.length === 0;
}

/** Enforce the token unless the board is a fully-sandboxed fixture. */
function enforced(env) {
  return !fullySandboxed(env);
}

/**
 * The token path. ONE source of truth: `store.ROOT` (the per-account data dir,
 * `~/Library/Application Support/AgentWorkforce` in prod, an
 * `AGENT_WORKFORCE_DATA` sandbox otherwise). The CLI and native app read the same
 * path via the same `store.ROOT`, so there is no second copy of the formula.
 */
function tokenPath() {
  return path.join(store.ROOT, TOKEN_FILE);
}

/** A fresh 256-bit token as hex. */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** Read the token file, or null if it is absent or empty. */
function readToken() {
  try {
    const t = fs.readFileSync(tokenPath(), 'utf8').trim();
    return t || null;
  } catch {
    return null;
  }
}

/**
 * Return the board token, generating and persisting one if absent. The file is
 * written mode 0o600 inside a dir forced to 0o700, because on macOS `$HOME` is
 * group-traversable (every local account shares primary gid `staff`), so only an
 * owner-only mode is a real boundary against another local account. Idempotent:
 * a second call returns the same token.
 */
function ensureToken() {
  const existing = readToken();
  if (existing) return existing;
  const dir = store.ROOT;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // mkdir honours the mode only on creation; force it in case the dir pre-existed
  // with a looser mode.
  try { fs.chmodSync(dir, 0o700); } catch { /* best-effort: the file mode is the real guard */ }
  const token = generateToken();
  // Write to a temp path then rename, and chmod BEFORE the rename so the token is
  // never briefly world/group-readable at its final name (atomic-write discards
  // the target's mode, so set it on the temp file).
  const tmp = path.join(dir, `.${TOKEN_FILE}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, token, { mode: 0o600 });
  try { fs.chmodSync(tmp, 0o600); } catch { /* writeFileSync mode already applied on most platforms */ }
  fs.renameSync(tmp, tokenPath());
  return token;
}

/** Parse the token cookie out of a Cookie header, or null. */
function cookieToken(req) {
  const raw = req && req.headers && req.headers.cookie;
  if (!raw) return null;
  for (const part of String(raw).split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === COOKIE_NAME) {
      const v = part.slice(eq + 1).trim();
      return v || null;
    }
  }
  return null;
}

/** The token a request presents: cookie, then header, then `?token=` query. */
function presentedToken(req, routingBase) {
  const c = cookieToken(req);
  if (c) return c;
  const h = req && req.headers && req.headers[HEADER_NAME];
  if (h) return String(h);
  const q = queryToken(req, routingBase);
  return q || null;
}

/** Just the `?token=` query value (or null). Separated so the dispatch can tell
 * a query-bootstrap request from a cookie/header one and set the cookie. */
function queryToken(req, routingBase) {
  try {
    return new URL(req.url, routingBase).searchParams.get('token') || null;
  } catch {
    return null;
  }
}

/**
 * Constant-time token comparison. Guards length first, because `timingSafeEqual`
 * throws on unequal-length buffers -- and a mismatched length is a mismatch, so
 * return false rather than leak the difference through an exception.
 */
function matches(presented, expected) {
  if (typeof presented !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** `Set-Cookie` value for the board token. HttpOnly so page JS cannot read it;
 * SameSite=Strict so another site cannot cause it to be sent (defence in depth
 * alongside crossSiteWrite); Path=/ so every route carries it. Not Secure: the
 * board is plain http on loopback. */
function cookieHeader(token) {
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/`;
}

/** The request path with the `token` query param removed, other params kept.
 * Used to strip the bootstrap token out of the URL after setting the cookie, so
 * it does not linger in history or a Referer. */
function pathWithoutToken(req, routingBase) {
  try {
    const u = new URL(req.url, routingBase);
    u.searchParams.delete('token');
    const q = u.searchParams.toString();
    return u.pathname + (q ? `?${q}` : '');
  } catch {
    return '/';
  }
}

/**
 * The bootstrap decision, PURE. A valid `?token=` on a GET/HEAD navigation, when
 * no cookie is set yet, is the browser / native-app first load: return the
 * cookie to set and the clean URL to redirect to (token stripped), so every
 * subsequent same-origin request carries the cookie automatically. This runs on
 * EVERY route -- including the exempt static shell -- so the operator can land on
 * `/?token=...`, get the cookie, and have the app's later `/api/*` calls succeed.
 * Returns `{ location, setCookie }` or null.
 */
function bootstrap({ token, req, routingBase, method }) {
  const isNav = method === 'GET' || method === 'HEAD';
  if (!isNav) return null;
  if (cookieToken(req)) return null;            // already have the cookie -> no redirect loop
  const q = queryToken(req, routingBase);
  if (!q || !matches(q, token)) return null;    // no/invalid query token -> not a bootstrap
  return { location: pathWithoutToken(req, routingBase), setCookie: cookieHeader(token) };
}

/**
 * Does the request present a valid token (cookie, header, or query)? PURE, so the
 * sensitive-route gate is testable without a bind. The caller decides WHICH routes
 * are sensitive; this only answers "is a good token here".
 */
function tokenOk({ token, req, routingBase }) {
  const presented = presentedToken(req, routingBase);
  return !!presented && matches(presented, token);
}

module.exports = {
  fullySandboxed, enforced, tokenPath, generateToken, readToken, ensureToken,
  cookieToken, presentedToken, queryToken, matches, cookieHeader, pathWithoutToken,
  bootstrap, tokenOk, COOKIE_NAME, HEADER_NAME,
};
