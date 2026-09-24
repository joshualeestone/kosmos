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

/*
 * #2413: observations are PROVIDER-QUALIFIED. The badge overlay for the Claude rows
 * and the badge overlay for the OpenAI rows are two different joins over two different
 * account lists; without the provider in the key, an OpenAI agent's `ok` could resolve
 * against the Claude account list (a codex agent on the default home records
 * configDir=null, which accountForAgent USED to map to the DEFAULT CLAUDE account)
 * and green a Claude account it has nothing to do with. Keying by
 * (provider, agent) makes an OpenAI observation reachable ONLY from the OpenAI overlay
 * and a Claude observation ONLY from the Claude one -- the isolation the two-derivations
 * habit this codebase warns about would otherwise break.
 */
const PROVIDER = Object.freeze({ ANTHROPIC: 'anthropic', OPENAI: 'openai', GOOGLE: 'google', XAI: 'xai' });
// The CLOSED set the injective-join claim above rests on. saw() enforces membership so
// the isolation is structural (a property of this module) rather than a convention the
// callers happen to keep -- a third caller passing an unrecognised or empty provider
// string cannot land an observation that a later read might mis-join. Derived from
// PROVIDER so adding a provider there updates the guard in one place.
const PROVIDER_VALUES = new Set(Object.values(PROVIDER));

// (provider, agent) -> { provider, agent, outcome, at }. Last qualifying observation
// only, per provider+agent. Unbounded only by the count of distinct (provider, agent)
// pairs ever seen this process (not a per-tick leak: saw() overwrites in place), and
// freshness gating means a stale entry for a removed agent never affects a verdict --
// so a periodic sweep is not needed for correctness. The join is INJECTIVE: `provider`
// is a closed, space-free enum ('anthropic'/'openai'/'google'/'xai', no one a prefix of another),
// so the text before the first space names the provider unambiguously and the rest is
// the agent -- an agent name may contain spaces (e.g. "Sonya Blade") without colliding.
const store = new Map();
function keyOf(provider, agent) { return provider + ' ' + agent; }

/*
 * #3136: a SECOND, DIR-keyed store for USER-INITIATED "Check now" outcomes. The
 * agent store above is filled passively by the ~60s sweep from a witnessed
 * streaming turn (status.js:6318), so an account with no currently-streaming
 * agent -- the normal state, and every agent-less account -- never records an `ok`
 * and its badge sits at signed_in_unverified forever (Josh, 0.6.68). "Check now"
 * fires a real `claude -p` liveness call (engine/create.claudeAccountLive) for
 * ONE account and records the outcome HERE, keyed by that account's resolved
 * config dir -- the same value the /api/accounts row and the server.js badge join
 * key on -- so it reaches the badge without going through an agent. Kept a
 * separate store, not folded into `saw`, because its key is a dir not an agent
 * and its outcome is a deliberate user probe, not a passively-witnessed call.
 * The verdict fn is shared: the join feeds it the FRESHER of the two stores.
 */
const dirStore = new Map();
function keyOfDir(provider, dir) { return provider + ' ' + dir; }

/*
 * Record an observed outcome for an agent on a provider. `provider` must be one of the
 * closed PROVIDER set (PROVIDER.ANTHROPIC / PROVIDER.OPENAI / PROVIDER.GOOGLE / PROVIDER.XAI) -- membership
 * is ENFORCED here, not merely asserted by the header comment, because this key is the sole
 * mechanism keeping one provider's observation from resolving against another's account;
 * a caller passing an unrecognised or empty provider must not land a
 * record a later read could mis-join. `outcome` must be OUTCOME.OK or OUTCOME.REJECTED;
 * anything else (including the null status.js passes for idle / needs-you / unknown
 * states) is IGNORED, so a prior real observation SURVIVES an idle tick rather than
 * being clobbered by a non-observation.
 */
function saw(provider, agent, outcome, now) {
  if (!PROVIDER_VALUES.has(provider)) return;
  if (typeof agent !== 'string' || agent === '') return;
  if (outcome !== OUTCOME.OK && outcome !== OUTCOME.REJECTED) return;
  const at = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  store.set(keyOf(provider, agent), { provider, agent, outcome, at });
}

function read(provider, agent) {
  const v = store.get(keyOf(provider, agent));
  return v ? { outcome: v.outcome, at: v.at } : null;
}

function all() {
  return [...store.values()].map((v) => ({ provider: v.provider, agent: v.agent, outcome: v.outcome, at: v.at }));
}

/*
 * #3136: record a USER-INITIATED "Check now" outcome for one account, keyed by
 * its resolved config dir. Same enforcement as saw(): a closed provider, a
 * non-empty dir, and only OUTCOME.OK / OUTCOME.REJECTED are stored -- anything
 * else (notably the UNKNOWN a capacity/network probe returns) is IGNORED, so a
 * prior real observation SURVIVES an inconclusive check rather than being
 * clobbered to gray. The provider is in the key so a Claude check can never be
 * read by the OpenAI overlay, the same isolation saw() rests on.
 */
function sawDir(provider, dir, outcome, now) {
  if (!PROVIDER_VALUES.has(provider)) return;
  if (typeof dir !== 'string' || dir === '') return;
  if (outcome !== OUTCOME.OK && outcome !== OUTCOME.REJECTED) return;
  const at = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  dirStore.set(keyOfDir(provider, dir), { provider, dir, outcome, at });
}

function readDir(provider, dir) {
  if (typeof dir !== 'string' || dir === '') return null;
  const v = dirStore.get(keyOfDir(provider, dir));
  return v ? { outcome: v.outcome, at: v.at } : null;
}

// Test-only: reset both in-memory records between cases.
function _clearForTest() { store.clear(); dirStore.clear(); }

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
 *   fresh 401  -> 'rejected'              (WINS over checkLive 'connected' -- the expired-401 case)
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
/*
 * The single owner of the fresh/stale DECISION. verdict() below and any other
 * reader (e.g. subscription.machineStatKey's memo key, #1959) MUST call this
 * rather than re-deriving `age >= 0 && age <= limit` -- two copies of one fact
 * drift silently, and a memo key that disagrees with the verdict it tracks would
 * serve a stale verdict indefinitely. Returns true only for a finite, non-future
 * observedAt within the window.
 */
function isFresh(observedAt, now, fm) {
  const nowN = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  const limit = typeof fm === 'number' && Number.isFinite(fm) && fm > 0 ? fm : freshMs();
  if (typeof observedAt !== 'number' || !Number.isFinite(observedAt)) return false;
  const age = nowN - observedAt;
  return age >= 0 && age <= limit;
}

function verdict({ checkLiveState, observedOutcome, observedAt, now, freshMs: fm } = {}) {
  const nowN = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  const limit = typeof fm === 'number' && Number.isFinite(fm) && fm > 0 ? fm : freshMs();
  const hasAt = typeof observedAt === 'number' && Number.isFinite(observedAt);
  const age = hasAt && nowN - observedAt >= 0 ? nowN - observedAt : null;
  const fresh = isFresh(observedAt, nowN, limit);

  if (fresh && observedOutcome === OUTCOME.REJECTED) return { badge: 'rejected', observedAt, ageMs: age };
  if (fresh && observedOutcome === OUTCOME.OK) return { badge: 'working', observedAt, ageMs: age };

  if (checkLiveState === 'connected') return { badge: 'signed_in_unverified', observedAt: null, ageMs: null };
  if (checkLiveState === 'none') return { badge: 'signed_out', observedAt: null, ageMs: null };
  return { badge: 'unchecked', observedAt: null, ageMs: null };
}

module.exports = { OUTCOME, PROVIDER, saw, read, all, sawDir, readDir, freshMs, isFresh, verdict, _clearForTest };
