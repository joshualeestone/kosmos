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
 * a mode-700 dir, and requires it on every request. On POSIX another account
 * reaches the port but cannot read the owner-only token file. A per-account PORT
 * (#910) is not a boundary: the port is a deterministic function of uid, uid is
 * world-readable via `dscl`, and the window is scannable. #910 stopped
 * ACCIDENTAL bleed and was never a control against a deliberate one.
 *
 * 🛑 THIS FILESYSTEM BOUNDARY IS POSIX-ONLY (#2040). On Windows the mode-600 /
 * mode-700 calls are silent no-ops (NTFS ignores POSIX modes; Node's `chmodSync`
 * only toggles the read-only bit), so the token inherits its parent ACL and
 * another local account CAN read it. Windows needs an NTFS ACL restriction that
 * is not yet in place. `ownerOnlyModeIsEnforced()` is the honest per-platform
 * answer; do not reason about this boundary without it.
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
// #2030: the marker whose ABSENCE tells install/setup.sh to open the browser once
// on an enforcing update (the #2023 board-auth repair). Written on a successful
// `?boot=` REDEMPTION (see seedReauthMarker / bootstrap), never at dispatch.
const REAUTH_SEEDED_FILE = '.reauth-seeded';
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

/**
 * #2030: the reauth-seeded marker path, same `store.ROOT` source of truth as
 * tokenPath() (and the same path install/setup.sh reads to decide whether to open).
 */
function reauthMarkerPath() {
  return path.join(store.ROOT, REAUTH_SEEDED_FILE);
}

/**
 * #2030: ensure the reauth-seeded marker exists, called on a successful `?boot=`
 * nonce REDEMPTION rather than by setup.sh at dispatch. Dispatch is not redemption:
 * setup.sh cannot see whether the browser actually navigated and took the cookie,
 * so seeding there marked machines done whose board still 403s. Writing it only when
 * a nonce is truly redeemed makes the #2023 repair self-healing -- a machine whose
 * browser never navigated stays unseeded and retries the auto-open on the next
 * update until it works, while a machine that DID redeem is seeded exactly once (by
 * the redeemer) and never re-opens.
 *
 * Idempotent, BEST-EFFORT and NON-GATING: by the time this runs the browser has
 * already been handed the durable cookie, so a failed marker write must never fail
 * the redemption -- its only cost is one more harmless tab on a later update.
 * Returns true if the marker exists after the call, false if the write failed.
 */
function seedReauthMarker() {
  try {
    // store.ROOT exists on any enforcing board (it holds board.token), so the
    // mkdir is a no-op in prod; it is here only so the marker still lands if the
    // dir is somehow absent, rather than silently failing the one write that
    // decides whether a later update re-opens.
    fs.mkdirSync(store.ROOT, { recursive: true });
    fs.writeFileSync(reauthMarkerPath(), '');
    return true;
  } catch {
    return false;
  }
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
 * Whether an owner-only file mode (a 0o600 file inside a 0o700 dir) is actually
 * ENFORCED by the OS as an access boundary against another local account.
 *
 * TRUE on POSIX (macOS, Linux): `chmod` sets real permission bits, so a 0o600
 * token in a 0o700 dir is unreadable by any other uid. This is the boundary the
 * whole token scheme leans on (see the file docblock).
 *
 * 🛑 FALSE on Windows (#2040): NTFS ignores POSIX modes. Node's `fs.chmodSync`
 * on win32 can only toggle the read-only attribute -- it cannot express "owner
 * only" -- so `chmodSync(path, 0o600)` returns success while changing NO ACL,
 * and the token inherits its parent's ACL (measured on Windows 11: SYSTEM,
 * Administrators and the user each Full Control, fully inherited). Another local
 * account can read it. The file-mode boundary does NOT exist there until a
 * Windows ACL restriction is added AND verified by reading the resulting ACL
 * (deferred; the card is #2040).
 *
 * Pure and platform-injected so both branches are testable without a Windows
 * host; defaults to the real platform.
 */
function ownerOnlyModeIsEnforced(platform = process.platform) {
  return platform !== 'win32';
}

/**
 * Return the board token, generating and persisting one if absent. The file is
 * written mode 0o600 inside a dir forced to 0o700. On POSIX
 * (`ownerOnlyModeIsEnforced()` true) that owner-only mode is a real boundary
 * against another local account -- necessary because on macOS `$HOME` is
 * group-traversable (every local account shares primary gid `staff`), so
 * nothing weaker suffices. 🛑 On Windows the mode is a silent no-op and this
 * boundary does NOT hold (#2040; see `ownerOnlyModeIsEnforced`): the token is
 * written and read normally, but nothing restricts who else on the machine can
 * read it until an NTFS ACL restriction lands. Idempotent: a second call
 * returns the same token.
 *
 * 🔑 RACE-SAFE ON THE NORMAL PATH: it returns the token actually ON DISK, not
 * merely the one this call generated. Two boards on the same account (a same-port
 * pair is settled by the bind, but a DIFFERENT-port pair -- `PORT=x kosmos start`
 * twice -- both reach provisioning) could each generate a different token on a
 * fresh first boot; whichever writes last would otherwise leave the other serving
 * a token that no longer matches the file every client reads, and that board would
 * 403 everyone. The claim is made with `link()`, atomic and EEXIST if the target
 * exists: the winner returns its own token, and every loser ADOPTS the token
 * already on disk, so the returned value equals the file. Content is written to a
 * temp FIRST (full, mode 0o600), so a reader never sees a half-written token --
 * `link` publishes an already-complete file atomically.
 *
 * ⚠️ ONE PATH IS BEST-EFFORT, NOT RACE-SAFE, and it is only reachable by outside
 * corruption: a target that EXISTS but is empty/whitespace (external truncation).
 * `link` cannot adopt an unreadable token, so we replace it with `rename` and then
 * re-read to return whatever is on disk. Under TRUE concurrency (two boards
 * recovering the SAME corrupt file at once) a later rename can still land after our
 * re-read, so the two may briefly disagree until one restarts. This never arises
 * from our own writes (they publish complete content), needs a corrupt file AND a
 * concurrent different-port boot, and self-heals on the next single boot -- so it
 * is accepted as a bounded recovery rather than guarded with a lock.
 */
function ensureToken() {
  const existing = readToken();
  if (existing) {
    // Self-heal: re-tighten the mode in case a prior process (or a restore, or a
    // umask slip) left the token file or its dir looser than owner-only. The
    // token is only a boundary while it stays unreadable by another account --
    // and only on POSIX: on Windows this chmod is a no-op (#2040), so the
    // re-tighten restores nothing there.
    try { fs.chmodSync(store.ROOT, 0o700); } catch { /* best-effort */ }
    try { fs.chmodSync(tokenPath(), 0o600); } catch { /* best-effort */ }
    return existing;
  }
  const dir = store.ROOT;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // mkdir honours the mode only on creation; force it in case the dir pre-existed
  // with a looser mode.
  try { fs.chmodSync(dir, 0o700); } catch { /* best-effort: on POSIX the file mode is the real guard (#2040: no-op on Windows) */ }
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
      // The target EXISTS but readToken() found it empty/whitespace (external
      // truncation) -- link() would EEXIST here forever and the board would 403
      // every request with no self-recovery short of a human deleting the file.
      // Replace the useless file (rename clobbers) and RE-READ, so we return the
      // value that is actually on disk -- ours, or a concurrent recoverer's that
      // landed first -- rather than blindly the token we generated. Best-effort
      // under true concurrency (see the docblock); it heals the deadlock.
      fs.renameSync(tmp, tokenPath());
      return readToken() || token;
    }
    throw err;
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* our temp; harmless if already gone (renamed into place) */ }
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

/** The request path with one query param removed, other params kept. Used to
 * strip the bootstrap secret (`token` or `boot`) out of the URL after setting the
 * cookie, so it does not linger in history or a Referer. */
function pathWithoutParam(req, routingBase, param) {
  try {
    const u = new URL(req.url, routingBase);
    u.searchParams.delete(param);
    const q = u.searchParams.toString();
    return u.pathname + (q ? `?${q}` : '');
  } catch {
    return '/';
  }
}

/** Back-compat name for the `?token=` bootstrap strip. */
function pathWithoutToken(req, routingBase) { return pathWithoutParam(req, routingBase, 'token'); }

// --- Single-use browser-open nonces (#1979) ----------------------------------
// The `?token=` bootstrap works, but it puts the DURABLE board token on the
// browser-open argv: `kosmos open` runs `open "$URL/?token=<durable>"` and the
// install open-once plist runs `/bin/sh -c 'open "$0"...' "$URL/?token=<durable>"`,
// and macOS `ps -ww -o args` shows that argv to every account on the box. The
// token is the SAME durable secret as the mode-600 file, so the exposure is
// forever.
//
// The closure: the caller (which already holds the board token, presented OFF
// argv via `kosmos_curl`'s `-H @file`) mints a single-use, short-TTL NONCE and
// hands the BROWSER the nonce. The browser redeems it for the same httpOnly
// cookie on its first nav. A nonce is useless once redeemed (single-use) and
// after its TTL, so where it appears on argv the exposure is bounded to a few
// minutes and one use, not forever.
//
// 🛑 RESIDUAL, STATED HONESTLY (not "no cross-account risk"): the nonce STILL
// rides the `open`/`sh`/browser argv -- you cannot hand a browser a URL without
// putting a redeemable value on argv -- so the exact #1946 hostile-second-account
// (`ps -ww -o args` in a tight loop) can, WITHIN the TTL, `curl .../?boot=<nonce>`
// and redeem it before the victim's browser does. The 302 sets `cookieHeader(token)`
// = `kosmos_board=<durable-token>`, so a race-winner recovers the DURABLE TOKEN
// ITSELF (in the Set-Cookie), not merely a session-scoped cookie -- winning the
// race is as good as the old leak. What #1979 changes is the SIZE of that exposure,
// not its existence: instead of reading the durable token off argv at leisure,
// forever, an attacker must now WIN a bounded (~2 min), single-use race -- the
// window is ~2 min not forever, one use not unlimited, and, BECAUSE it is
// single-use, a lost race is DETECTABLE to the victim (their dashboard 403s /
// re-prompts instead of silently sharing a live secret). The TTL below is the knob that trades that window against redeem
// reliability (it must outlast `kosmos open`'s immediate redeem and setup.sh's
// RunAtLoad open). Fully removing the argv value would need a different handoff
// than `open <url>` and is out of scope here.
//
// In-memory and process-local: the board process both mints (via POST
// /api/board-nonce) and redeems (in `bootstrap`), so a Map in this module is the
// whole store -- modeled on engine/githubdevice.js's in-memory expiring state.
// The nonce is its OWN random value; it never encodes or carries the durable
// token. The clock is a seam (`_setNonceClock`) because the repo's suite advances
// time and a wall-clock TTL that cannot be driven is exactly what killed a prior
// TTL cache (#1618).
const NONCE_TTL_MS = 120000; // 2 min: covers `kosmos open`'s immediate redeem and the install open-once delay, and no more.
const _nonces = new Map(); // nonce -> expiresAt (epoch ms)
let _nonceNow = () => Date.now();
function _setNonceClock(fn) { _nonceNow = typeof fn === 'function' ? fn : (() => Date.now()); }
function _sweepNonces(now) { for (const [n, exp] of _nonces) { if (exp <= now) _nonces.delete(n); } }

/** Mint a single-use nonce, valid for NONCE_TTL_MS. Sweeps expired entries so a
 *  board that mints many opens does not grow the map without bound. */
function mintNonce() {
  const now = _nonceNow();
  _sweepNonces(now);
  const nonce = crypto.randomBytes(32).toString('hex');
  _nonces.set(nonce, now + NONCE_TTL_MS);
  return nonce;
}

/** Redeem a nonce. Returns true only for a known, unexpired nonce, and BURNS it
 *  either way (single-use: a second redeem, or a redeem after expiry, is false),
 *  so a nonce that leaked onto argv cannot be replayed. */
function redeemNonce(nonce) {
  if (typeof nonce !== 'string' || !nonce) return false;
  const exp = _nonces.get(nonce);
  if (exp === undefined) return false;
  _nonces.delete(nonce);              // single-use: gone whether valid or stale
  return exp > _nonceNow();
}

/** The `?boot=<nonce>` query value, or null. */
function bootNonce(req, routingBase) {
  try { return new URL(req.url, routingBase).searchParams.get('boot') || null; } catch { return null; }
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
  /* #1979: a `?boot=<nonce>` from `kosmos open` / the install open-once handoff
     redeems (single-use) for the SAME cookie the `?token=` path sets -- so the
     durable token stays off the browser-open argv. Tried before `?token=` so the
     nonce path is preferred; `redeemNonce` burns the nonce, so this must run at
     most once per request (the dispatch calls bootstrap once). */
  const boot = bootNonce(req, routingBase);
  if (boot && redeemNonce(boot)) {
    /* #2030: `viaBootNonce` flags a real `?boot=` nonce redemption vs a `?token=`
       bootstrap. #2073 NOTE: it is now VESTIGIAL for seeding -- the caller
       (server.js) seeds the #2023 reauth marker on BOTH paths (the app-only install
       authenticates via `?token=`, and both paths take the durable cookie in the
       same 302, so both are a redemption to mark). The flag is left in place (still
       set, still asserted by engine.boardauth-nonce-1979.test.js) in case a future
       caller needs to tell the two apart; nothing reads it to gate seeding any more.
       `bootstrap` stays PURE; the caller does the write. */
    return { location: pathWithoutParam(req, routingBase, 'boot'), setCookie: cookieHeader(token), viaBootNonce: true };
  }
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
  pathWithoutParam, bootstrap, tokenOk, COOKIE_NAME, HEADER_NAME,
  // #2040: honest per-platform answer to "is the file-mode boundary real here".
  ownerOnlyModeIsEnforced,
  // #1979: single-use browser-open nonces.
  mintNonce, redeemNonce, bootNonce, _setNonceClock,
  // #2030: reauth-seeded marker, written on `?boot=` redemption not at dispatch.
  reauthMarkerPath, seedReauthMarker, REAUTH_SEEDED_FILE,
};
