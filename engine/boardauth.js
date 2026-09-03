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
 *
 * ⚠️ INHERITED LIMIT, STATED SO IT IS NOT SILENT: `sandbox.audit` keys on each var
 * being SET, not on it pointing at a genuine stub (tmuxInert is `Boolean(TMUX_BIN)`,
 * not a check that the binary is inert). This predicate began life only as a
 * refuse-to-boot check (#634); the token guard now also reads it as a security
 * boundary, so the "set, therefore safe" assumption is worth naming. The residual
 * is an operator who points ALL FOUR data/launch/workers/projects dirs AND
 * TMUX_BIN at REAL paths: that board runs fully live with the token OFF. It is not
 * attacker-reachable -- it needs the victim's own boot env, the real installer and
 * launcher set NONE of these, and it is the operator disarming their own board --
 * so it is inherited deliberately rather than re-validated here. The partial-
 * sandbox boot refusal is what leaves "all four set + tmux inert" as the only
 * non-enforcing shape a booting board can take.
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
 *
 * 🔑 RACE-SAFE ACROSS PROCESSES, and it returns the token that is actually ON
 * DISK, never merely the one this call generated. Two boards started on the same
 * account (a same-port pair is settled by the bind, but a DIFFERENT-port pair --
 * `PORT=x kosmos start` twice -- both reach provisioning) could each generate a
 * different token on a fresh first boot; whichever writes last would leave the
 * other serving an in-memory token that no longer matches the file every client
 * reads, and that board would 403 everyone. The claim is made with `link()`,
 * which is atomic and fails with EEXIST if the target already exists: the winner
 * returns its own token, and every loser ADOPTS the token already on disk. So the
 * value returned always equals the file, whoever won. The content is written to a
 * temp file FIRST (full, mode 0o600), so a reader never sees a half-written token
 * -- `link` publishes an already-complete file atomically.
 */
function ensureToken() {
  const existing = readToken();
  if (existing) {
    // Self-heal: re-tighten the mode in case a prior process (or a restore, or a
    // umask slip) left the token file or its dir looser than owner-only. The
    // token is only a boundary while it stays unreadable by another account.
    try { fs.chmodSync(store.ROOT, 0o700); } catch { /* best-effort */ }
    try { fs.chmodSync(tokenPath(), 0o600); } catch { /* best-effort */ }
    return existing;
  }
  const dir = store.ROOT;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // mkdir honours the mode only on creation; force it in case the dir pre-existed
  // with a looser mode.
  try { fs.chmodSync(dir, 0o700); } catch { /* best-effort: the file mode is the real guard */ }
  const token = generateToken();
  // Write the full content to a temp path, chmod it 0o600 BEFORE it is published,
  // then claim the final name with link() -- atomic, and EEXIST if a racer got
  // there first, in which case we adopt whatever they wrote.
  const tmp = path.join(dir, `.${TOKEN_FILE}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, token, { mode: 0o600 });
  try { fs.chmodSync(tmp, 0o600); } catch { /* writeFileSync mode already applied on most platforms */ }
  try {
    fs.linkSync(tmp, tokenPath());   // atomic exclusive claim
    return token;                     // we won the race
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      const winner = readToken();     // a racer published first; adopt its token
      if (winner) return winner;
    }
    throw err;
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* our temp; harmless if already gone */ }
  }
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
 * board is plain http on loopback.
 *
 * Max-Age makes it PERSISTENT rather than a session cookie, so a browser-only
 * operator who reopens a bookmarked bare URL after quitting the browser is not met
 * by a 403 shell until they re-run `kosmos open`. This costs nothing in security:
 * the token already persists in the mode-600 file (the cookie only caches it), the
 * cookie lives in this account's own browser profile (unreadable by another
 * account), and if the token is ever rotated a stale cookie simply re-bootstraps.
 * 34560000s (400 days) is the ceiling browsers actually honour. */
function cookieHeader(token) {
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=34560000`;
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
