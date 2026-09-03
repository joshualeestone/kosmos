'use strict';
/**
 * kosmos#1930 -- a per-account (config-dir-keyed) cache of the LIVE Claude auth condition.
 *
 * Why this exists: the board classifies a pane's bottom rows every 5s, so a repaired agent
 * whose old `401 OAuth access token has expired` still sits in scrollback keeps reading
 * `auth_failed` forever -- the sign-in was fixed OFF-PANE and the pane's bytes are identical
 * before and after, so no amount of reading the pane can tell "failing now" from "failed and
 * since repaired". The only signal that can is the actual auth CONDITION, `claude auth status`
 * (subscription.checkLive). That is a subprocess, and #1885 deliberately keeps it OFF the 5s
 * tick, so we run it PER ACCOUNT (agents share accounts -> key by config dir), CACHED with a
 * TTL, and ASYNC: a scraped auth_failed kicks off a check that never blocks the tick; the
 * result is consulted on a LATER tick.
 *
 * 🛑 THE SAFETY CONTRACT (this is the whole point of rule 3b -- false calm is the failure that
 * ships): `verdict()` returns HEALTHY only on POSITIVE live evidence that the sign-in works.
 * expired / unreachable / not-yet-checked / stale ALL return a non-HEALTHY verdict, so the
 * caller leaves `auth_failed` standing. A genuinely-expired account is never suppressed.
 */

const subscription = require('./subscription');

// subscription.checkLive returns its own STATE: CONNECTED (signed in / healthy),
// NONE (not connected -> expired/revoked/absent), UNKNOWN (could not reach Claude Code).
const HEALTHY = 'healthy';       // positive evidence the sign-in currently works -> suppress a stale 401
const EXPIRED = 'expired';       // checkLive says not connected -> auth_failed stands
const UNKNOWN = 'unknown';       // checkLive could not tell -> auth_failed stands (conservative)
const UNCHECKED = 'unchecked';   // no fresh cache entry yet -> auth_failed stands; a check is kicked off

// A config dir check is trusted for this long before it must be re-probed. Short enough that a
// repair shows on the board within a poll or two; long enough that the tick never storms
// subprocesses.
const TTL_MS = 30 * 1000;

// dirKey('' | null | undefined) -> the default account's stable key.
const DEFAULT_KEY = '(default)';
function dirKey(configDir) { return configDir ? String(configDir) : DEFAULT_KEY; }

// The live checker, injectable for tests. Real one calls checkLive the way accounts.js does:
// the DEFAULT account omits configDir (passing its dir would make `claude auth status` use a
// path resolution that is wrong for the default -- accounts.js:287 documents this).
let checker = async (configDir) => (configDir
  ? subscription.checkLive({ configDir })
  : subscription.checkLive());
function setChecker(fn) { checker = fn; }        // tests
function resetForTest() { cache.clear(); }       // tests

// dirKey -> { verdict, at, checking }
const cache = new Map();

function verdictFromLive(live) {
  const s = live && live.state;
  if (s === subscription.STATE.CONNECTED) return HEALTHY;
  if (s === subscription.STATE.NONE) return EXPIRED;
  return UNKNOWN; // UNKNOWN, or any shape we do not recognise -> conservative
}

// Kick off a live check for this config dir unless one is already in flight. Fire-and-forget:
// the promise is intentionally not awaited by callers on the tick; it updates the cache when it
// settles. A thrown checker is swallowed into UNKNOWN (never a rejected promise reaching the
// tick, never a HEALTHY on error).
function kickCheck(configDir, nowMs) {
  const key = dirKey(configDir);
  const cur = cache.get(key);
  if (cur && cur.checking) return;
  cache.set(key, { verdict: cur ? cur.verdict : UNCHECKED, at: cur ? cur.at : 0, checking: true });
  Promise.resolve()
    .then(() => checker(configDir))
    .then((live) => { cache.set(key, { verdict: verdictFromLive(live), at: Date.now(), checking: false }); })
    .catch(() => { cache.set(key, { verdict: UNKNOWN, at: Date.now(), checking: false }); });
}

/**
 * verdict(configDir, nowMs) -> HEALTHY | EXPIRED | UNKNOWN | UNCHECKED  (never throws, never blocks).
 * Reads the cache; if the entry is absent or older than the TTL, kicks off an async re-check and
 * returns the LAST KNOWN verdict (or UNCHECKED). Only a fresh HEALTHY entry returns HEALTHY, so
 * a stale-but-formerly-healthy entry does not linger as a suppression past the TTL.
 */
function verdict(configDir, nowMs = Date.now()) {
  const key = dirKey(configDir);
  const cur = cache.get(key);
  const fresh = cur && !cur.checking && (nowMs - cur.at) <= TTL_MS && cur.at > 0;
  if (!cur || (nowMs - (cur.at || 0)) > TTL_MS) kickCheck(configDir, nowMs);
  if (fresh) return cur.verdict;
  // A stale entry is not trusted; report its verdict only if it is EXPIRED/UNKNOWN (which keep
  // auth_failed standing anyway). A stale HEALTHY must NOT suppress -> downgrade to UNCHECKED.
  if (cur && cur.verdict !== HEALTHY) return cur.verdict;
  return UNCHECKED;
}

module.exports = { verdict, HEALTHY, EXPIRED, UNKNOWN, UNCHECKED, TTL_MS, dirKey, setChecker, resetForTest };
