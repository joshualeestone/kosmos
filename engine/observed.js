'use strict';

/*
 * The LAST OBSERVED real-call outcome per agent, so the account badge can render
 * what actually happened to a real request instead of what `claude auth status`
 * predicts. kosmos#1921 (split from #1916); plan: .claude/plans/badge-observed-1921.md.
 *
 * 🔑 WHY THIS EXISTS. `subscription.checkLive` reads `claude auth status`, which
 * returns loggedIn:true for a token being REJECTED 401 (measured, #874) -- it can
 * only prove a credential EXISTS, never that a request would succeed. #1884 already
 * surfaces real 401s from agents that are ALREADY making real calls. So we do not
 * need to ASK the question (a probe spends the person's own quota, N accounts x ~4s,
 * unasked); we need to STOP THROWING AWAY THE ANSWERS WE ALREADY GET. This records
 * the last observed outcome + when, and the badge renders from that.
 *
 * 🔑 WHY IN-MEMORY, NOT A STORE ON DISK. The observation point (status.snapshot,
 * the ~60s board sweep) and the badge render (/api/accounts) run in the SAME
 * process. On restart nothing has been observed yet, and "not recently checked" is
 * the correct, honest default -- so there is nothing to persist, and no per-tick
 * disk write. A restarted server that has not watched an agent make a call has
 * genuinely observed nothing, and says so.
 *
 * 🔑 WHY THIS MODULE INTERPRETS OUTCOMES, NOT STATE NAMES. `status.js` owns the
 * STATE vocabulary (WORKING / AUTH_FAILED / IDLE / ...) and maps it to an outcome
 * before calling saw(). Keeping the STATE->outcome mapping in the one place that
 * defines STATE avoids a second copy of it here (the "two derivations of one fact"
 * habit this codebase warns about) AND keeps this module dependency-free, so
 * status.js can require it without a load-order cycle.
 */

// The only two outcomes worth recording. A weak state (idle, needs-you) is NOT an
// observed call outcome and must never be stored -- storing an "ok" for idle would
// re-introduce exactly the false green this feature removes.
const OUTCOME = Object.freeze({ OK: 'ok', REJECTED: '401' });

// agent name -> { outcome, at }. Last qualifying observation only. Unbounded only by
// the count of distinct agent names ever seen this process (not a per-tick leak: saw()
// overwrites in place), and freshness gating means a stale entry for a removed agent
// never affects a verdict -- so a periodic sweep is not needed for correctness.
const store = new Map();

/*
 * Record an observed outcome for an agent. `outcome` must be OUTCOME.OK or
 * OUTCOME.REJECTED; anything else (including the null status.js passes for idle /
 * needs-you / unknown states) is IGNORED, so a prior real observation SURVIVES an
 * idle tick rather than being clobbered by a non-observation.
 */
function saw(agent, outcome, now) {
  if (typeof agent !== 'string' || agent === '') return;
  if (outcome !== OUTCOME.OK && outcome !== OUTCOME.REJECTED) return;
  const at = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  store.set(agent, { outcome, at });
}

function read(agent) {
  const v = store.get(agent);
  return v ? { outcome: v.outcome, at: v.at } : null;
}

function all() {
  return [...store.entries()].map(([agent, v]) => ({ agent, outcome: v.outcome, at: v.at }));
}

// Test-only: reset the in-memory record between cases.
function _clearForTest() { store.clear(); }

/*
 * How recent an observation must be to still drive the badge. The background sweep
 * runs ~every 60s, so a working account refreshes well inside this window; five
 * minutes is a comfortable "recently" without asserting a confident state from
 * genuinely stale data. Env is the test seam only.
 */
function freshMs() {
  const v = Number(process.env.AGENT_WORKFORCE_OBSERVED_FRESH_MS);
  return Number.isFinite(v) && v > 0 ? v : 5 * 60 * 1000;
}

/*
 * The one place the badge verdict is decided, pure and unit-tested.
 *
 * A FRESH observation wins over checkLive; observedOutcome is the single last outcome
 * seen, so exactly one of the two fresh arms is ever eligible -- they are ordered for
 * reading, not because both can be live at once:
 *   fresh 401  -> 'rejected'              (WINS over checkLive 'connected' -- the Ben case)
 *   fresh ok   -> 'working'               (also rescues a crashed probe: observed > predicted)
 *   else 'connected' -> 'signed_in_unverified'  (a login exists; NOT verified working; NOT green)
 *   else 'none'      -> 'signed_out'
 *   else             -> 'unchecked'       (checkLive threw / unknown, nothing observed)
 *
 * 🛑 Freshness gates BOTH the positive AND the negative. A STALE 401 does not keep
 * asserting "not connected" -- the person may have re-signed-in since -- it falls
 * back to checkLive. This honours the invariant repeated across this codebase
 * (server.js:3378, accounts.js:307): a stale or blind signal must never be turned
 * into a confident connected / not-connected. Only a FRESH observation is confident.
 */
function verdict({ checkLiveState, observedOutcome, observedAt, now, freshMs: fm } = {}) {
  const nowN = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  const limit = typeof fm === 'number' && Number.isFinite(fm) && fm > 0 ? fm : freshMs();
  const hasAt = typeof observedAt === 'number' && Number.isFinite(observedAt);
  const age = hasAt && nowN - observedAt >= 0 ? nowN - observedAt : null;
  const fresh = age !== null && age <= limit;

  if (fresh && observedOutcome === OUTCOME.REJECTED) return { badge: 'rejected', observedAt, ageMs: age };
  if (fresh && observedOutcome === OUTCOME.OK) return { badge: 'working', observedAt, ageMs: age };

  if (checkLiveState === 'connected') return { badge: 'signed_in_unverified', observedAt: null, ageMs: null };
  if (checkLiveState === 'none') return { badge: 'signed_out', observedAt: null, ageMs: null };
  return { badge: 'unchecked', observedAt: null, ageMs: null };
}

module.exports = { OUTCOME, saw, read, all, freshMs, verdict, _clearForTest };
