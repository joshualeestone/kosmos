'use strict';
/**
 * kosmos#2093 -- a per-account (codex-home-keyed) cache of the LIVE OpenAI auth condition.
 * The PRODUCE-direction sibling of engine/authprobe.js (#1930).
 *
 * Why this exists: status.js `classify()` has an auth_failed read on the CLAUDE pane path
 * (`authFailed(tail)`) but NONE on the codex path -- that branch is needs_you / working / idle
 * and otherwise UNKNOWN ("nothing on its screen says what it is doing"). So a running codex
 * agent whose credential is dead reads UNKNOWN forever, never the actionable auth_failed with a
 * re-auth remedy. That dead-credential-on-a-running-agent is the #1906 fail-open residual:
 * `create.accountConnectable` deliberately lets an UNREACHABLE-at-create check through (an
 * unreachable check must never block a legitimate account), so a credential that was unreachable
 * at create but is ACTUALLY dead is created and 401s raw on its first turn (#1903's symptom).
 *
 * 🛑 WHY NOT A SCREEN MARKER. A scraper cannot separate a genuine dead-credential 401 from
 * codex's TRANSIENT reconnect-loop 401 (status.js's own CODEX_WORKING fixture: "Unexpected
 * status 401 Unauthorized" during a live reconnect reads WORKING, correctly). The only signal
 * that discriminates is the actual auth CONDITION: `openaiaccounts.checkLive` (GET /v1/models --
 * 200 for a working key, 401 for a rejected one; an absent auth file or OpenAI's own
 * `invalid_api_key` are the only things it maps to NONE).
 *
 * 🛑 THE SAFETY CONTRACT (mirrors #1930's, INVERTED, because this direction is inverted). #1930
 * suppresses a red, so its danger is false CALM and it only ever acts on positive HEALTHY. This
 * one PRODUCES a red, so its danger is a false RED that tells a working agent its sign-in is
 * broken -- so `verdict()` returns EXPIRED (the produce trigger) ONLY on a POSITIVE checkLive
 * NONE. unreachable / not-yet-checked / stale-EXPIRED / connected ALL return a non-EXPIRED
 * verdict, so the caller leaves the pane's UNKNOWN standing. An unreachable check never reddens
 * a good agent -- the exact fail-open create.accountConnectable is built on, applied to the read
 * side. This is the safety net BEHIND that create-time fail-open, never a second gate in front.
 *
 * OFF-TICK like authprobe: checkLive is a network call and #1885 keeps live checks off the 5s
 * tick, so this runs PER ACCOUNT (agents share a codex home -> key by dir), CACHED with a TTL,
 * and ASYNC: a probe is kicked off and never awaited on the tick; the result is consulted on a
 * LATER tick.
 */

const subscription = require('./subscription');   // the shared STATE enum openaiaccounts.checkLive uses
const openaiaccounts = require('./openaiaccounts');
// ONE copy of the verdict strings, required from authprobe so the two probes cannot drift (the
// same "one definition, not two" discipline status.js applies to LIVE_AUTH_HEALTHY).
const authprobe = require('./authprobe');
const { HEALTHY, EXPIRED, UNKNOWN, UNCHECKED } = authprobe;

// A codex-home check is trusted for this long before it must be re-probed. Same value and
// reasoning as authprobe.TTL_MS: short enough that a repair (or a fresh death) shows on the
// board within a poll or two; long enough that the tick never storms subprocesses/network.
const TTL_MS = 30 * 1000;

// dirKey('' | null | undefined) -> the default codex home's stable key. A codex agent on the
// default home records configDir=null in its job (create.readJob), so this collapses those to
// one cache entry. This module's cache is SEPARATE from authprobe's, so '(default)' here (the
// default codex home) never collides with '(default)' there (the default Claude account).
const DEFAULT_KEY = '(default)';
function dirKey(dir) { return dir ? String(dir) : DEFAULT_KEY; }

// The live checker, injectable for tests. Real one calls openaiaccounts.checkLive.
// 🛑 A NULL dir must NOT be passed straight to checkLive: openaiaccounts.authFile(null) resolves
// `path.resolve('')` -> the process CWD, whose auth.json is absent -> a false NONE (which would
// redden EVERY healthy default-home codex agent). The default codex home is a real resolved path
// from openaiaccounts.defaultDir(); resolve null to it here, exactly as list()/listLive() feed
// checkLive a real dir per row rather than null.
let checker = async (dir) => openaiaccounts.checkLive(dir || openaiaccounts.defaultDir());
function setChecker(fn) { checker = fn; }        // tests
function resetForTest() { cache.clear(); }       // tests

// dirKey -> { verdict, at, checking }
const cache = new Map();

function verdictFromLive(live) {
  const s = live && live.state;
  if (s === subscription.STATE.CONNECTED) return HEALTHY;
  if (s === subscription.STATE.NONE) return EXPIRED;
  return UNKNOWN; // UNKNOWN, unreachable, or any shape we do not recognise -> conservative (no produce)
}

// Kick off a live check for this dir unless one is already in flight. Fire-and-forget: the
// promise is intentionally not awaited by callers on the tick; it updates the cache when it
// settles. A thrown checker is swallowed into UNKNOWN (never a rejected promise reaching the
// tick, and never an EXPIRED on error -- an errored check must not produce a red).
function kickCheck(dir) {
  const key = dirKey(dir);
  const cur = cache.get(key);
  if (cur && cur.checking) return;
  cache.set(key, { verdict: cur ? cur.verdict : UNCHECKED, at: cur ? cur.at : 0, checking: true });
  Promise.resolve()
    .then(() => checker(dir))
    .then((live) => { cache.set(key, { verdict: verdictFromLive(live), at: Date.now(), checking: false }); })
    .catch(() => { cache.set(key, { verdict: UNKNOWN, at: Date.now(), checking: false }); });
}

/**
 * verdict(dir, nowMs) -> HEALTHY | EXPIRED | UNKNOWN | UNCHECKED  (never throws, never blocks).
 * Reads the cache; if the entry is absent or older than the TTL, kicks off an async re-check and
 * returns the LAST KNOWN safe verdict. Only a FRESH EXPIRED returns EXPIRED, so a stale-but-
 * formerly-dead entry does not keep reddening an account that has since been repaired.
 *
 * ⚠️ STALE POLARITY IS THE MIRROR OF authprobe's, and it must be, because the trusted verdict is
 * the opposite one. authprobe downgrades a stale HEALTHY (its dangerous positive -> a stale
 * suppression). This downgrades a stale EXPIRED (its dangerous positive -> a stale red over a
 * repaired account); a stale HEALTHY/UNKNOWN is safe to report because neither produces.
 */
function verdict(dir, nowMs = Date.now()) {
  const key = dirKey(dir);
  const cur = cache.get(key);
  const fresh = cur && !cur.checking && (nowMs - cur.at) <= TTL_MS && cur.at > 0;
  if (!cur || (nowMs - (cur.at || 0)) > TTL_MS) kickCheck(dir);
  if (fresh) return cur.verdict;
  // A stale entry is not trusted to PRODUCE. Report its verdict only if it is NOT EXPIRED (a
  // stale HEALTHY/UNKNOWN produces nothing anyway); a stale EXPIRED must NOT redden -> UNCHECKED.
  if (cur && cur.verdict !== EXPIRED) return cur.verdict;
  return UNCHECKED;
}

module.exports = {
  verdict,
  HEALTHY, EXPIRED, UNKNOWN, UNCHECKED,
  TTL_MS,
  dirKey,
  setChecker,   // test seam
  resetForTest, // test seam
};
