'use strict';

/*
 * #3410 PR 2b: recover a network-wedged agent by itself once the network is back.
 * Josh (#3410): "I don't want to have to run Claude Doctor. I want Kosmos to solve this issue
 * for me." The card asks to "AUTO-RECONNECT / retry the agent when connectivity returns".
 *
 * WHAT IT DOES. When Claude Code gives up on a network error it stops at its prompt with
 * "⏺ API Error: …" on screen, and status.js reads connection_lost. A message typed into that
 * pane makes it send a new request and carry on with its context (measured 2026-09-24: a wedged
 * agent asked to "retry" answered its original request). So the recovery is a nudge delivered
 * through chat.deliver, the board's own typing path, NOT a restart: removal.restart relaunches
 * the session and loses the agent's in-flight context.
 *
 * WHEN. Only when all hold:
 *  - the reconciled state is connection_lost on at least MIN_SWEEPS consecutive sweeps, with the
 *    SAME evidence line each time (status.js only reports connection_lost while Claude Code's own
 *    error row is the latest thing on screen; any later retry row or output supersedes it);
 *  - a connectivity probe succeeds (the caller's `probe`), so a nudge is not wasted while the
 *    network is still down;
 *  - fewer than MAX_NUDGES nudges in this outage. Past that it ESCALATES: no more nudges, a log
 *    line, and the card stays connection_lost, which heartbeat already surfaces to a person.
 *
 * The planner is PURE and the executor is injected, so tests drive both without touching a real
 * agent. Nothing here runs by itself: server.js calls sweepOnce behind the live-execution gate.
 */

const MIN_SWEEPS = 2;
const MAX_NUDGES = 3;
// The budget is MAX_NUDGES per OUTAGE, not per rolling window: a retry cycle that reads WORKING
// for longer than a window would otherwise earn a fresh nudge every cycle, forever. An outage
// ends (the history is dropped) only when the agent has not been lost for RECOVERED_MS AND the
// newest nudge is at least WINDOW_MS old. A nudge makes Claude Code retry, and a retry reads
// WORKING, so a short spell of not-lost is not a recovery.
const WINDOW_MS = 30 * 60 * 1000;
const RECOVERED_MS = 10 * 60 * 1000;
const NUDGE_TEXT = 'Your connection to the API is back. Please retry what you were doing.';

/*
 * One agent's decision. `entry` is this agent's book entry ({ evidence, sweeps, nudges[] }) as it
 * stands AFTER this sweep's observation was folded in (see observe). Returns
 * { act: 'none' | 'wait' | 'nudge' | 'escalate', because }.
 */
function planHeal(entry, now, probeOk) {
  if (!entry || entry.evidence == null) return { act: 'none', because: 'not connection_lost' };
  // Escalation is sticky until the outage ends and the entry is cleared (see WINDOW_MS).
  if (entry.escalated) return { act: 'escalate', because: 'already escalated; waiting for a person or a real recovery' };
  // Corrupt history counts as fully used, so it escalates rather than nudging again.
  const used = Array.isArray(entry.nudges) ? entry.nudges.length : MAX_NUDGES;
  if (used >= MAX_NUDGES) {
    return { act: 'escalate', because: `nudged ${used} time(s) in this outage and it is still connection_lost` };
  }
  if (!(Number.isInteger(entry.sweeps) && entry.sweeps >= MIN_SWEEPS)) {
    return { act: 'wait', because: `connection_lost on ${entry.sweeps} sweep(s); waiting for ${MIN_SWEEPS} with the same error line` };
  }
  if (probeOk !== true) return { act: 'wait', because: 'the network is still unreachable, so a retry would fail again' };
  return { act: 'nudge', because: 'connection_lost persisted with the same error line and the network is reachable again' };
}

/* Fold one sweep's reading of an agent into its book entry. A different evidence line restarts
   the count, so only a pane that has not changed can reach MIN_SWEEPS. */
function observe(prev, evidence, now) {
  // A non-array prev.nudges is kept as-is on purpose: planHeal treats corrupt history as used up
  // (escalate), and sweepOnce re-wraps it only when a nudge is actually sent.
  const nudges = prev && Array.isArray(prev.nudges) ? prev.nudges : (prev ? prev.nudges : []);
  const escalated = !!(prev && prev.escalated); // log an escalation once per loss, not every sweep
  /* #3410: lostSince marks when THIS drop began (the first lost reading after a not-lost one), so
     the board can tell retries sent in this drop from ones kept from an earlier drop in the same
     budget window. It never feeds the planner's cap, which deliberately spans drops. */
  const lostSince = prev && prev.evidence != null && Number.isFinite(prev.lostSince) ? prev.lostSince : (Number.isFinite(now) ? now : null);
  if (prev && prev.evidence === evidence) return { evidence, sweeps: (prev.sweeps || 0) + 1, nudges, escalated, okSince: null, lostSince };
  return { evidence, sweeps: 1, nudges, escalated, okSince: null, lostSince };
}

/*
 * One sweep. o = { roster, book (Map session -> entry), now, probe: () => Promise<boolean>,
 * deliver: (session, text, roster) => result, DELIVERY, log }. Returns { results }.
 * The probe runs at most once per sweep, and only when some agent is ready to be nudged.
 */
async function sweepOnce(o) {
  const book = (o && o.book instanceof Map) ? o.book : new Map();
  // An unreadable roster (safeRoster returns null when the snapshot fails) is NOT an empty fleet:
  // treating it as one would prune every entry, wiping the nudge history and escalations.
  if (!o || !Array.isArray(o.roster)) return { results: [], skipped: 'roster unreadable' };
  const roster = o.roster;
  const now = o && Number.isFinite(o.now) ? o.now : Date.now();
  const log = (o && typeof o.log === 'function') ? o.log : null;
  const results = [];
  const seen = new Set();
  let probed = false;
  let probeOk = false;
  for (const agent of roster) {
    const session = agent && agent.sessionName;
    if (!session) continue;
    seen.add(session);
    const display = agent.name || session;
    if (agent.state !== 'connection_lost' || typeof agent.stateEvidence !== 'string' || !agent.stateEvidence) {
      const prev = book.get(session);
      if (!prev) continue;
      // Not lost right now. Keep the history (a nudge's own retry reads WORKING) and drop it only
      // when the outage has ended (see WINDOW_MS).
      const okSince = Number.isFinite(prev.okSince) ? prev.okSince : now;
      const nudges = Array.isArray(prev.nudges) ? prev.nudges : [];
      const lastNudge = nudges.reduce((m, t) => (Number.isFinite(t) && t > m ? t : m), -Infinity);
      if (now - okSince >= RECOVERED_MS && now - lastNudge >= WINDOW_MS) { book.delete(session); continue; }
      book.set(session, { ...prev, evidence: null, sweeps: 0, okSince });
      continue;
    }
    const entry = observe(book.get(session), agent.stateEvidence, now);
    book.set(session, entry);
    let plan = planHeal(entry, now, probed ? probeOk : undefined);
    if (plan.act === 'wait' && entry.sweeps >= MIN_SWEEPS && !probed) {
      probed = true;
      try { probeOk = (await o.probe()) === true; } catch { probeOk = false; }
      plan = planHeal(entry, now, probeOk);
    }
    if (plan.act !== 'nudge') {
      results.push({ session, name: display, act: plan.act, because: plan.because });
      if (plan.act === 'escalate' && !entry.escalated) {
        entry.escalated = true; // sticky, and logged once
        if (log) { try { log({ name: display, session, act: 'escalate', because: plan.because }); } catch { /* never breaks a sweep */ } }
      }
      continue;
    }
    // Count the attempt whatever happens, so a nudge that fails still moves toward escalation.
    entry.nudges = (Array.isArray(entry.nudges) ? entry.nudges : []).concat(now);
    entry.sweeps = 0; // the next nudge needs a fresh run of unchanged sweeps
    let state = null;
    try { const r = o.deliver(session, NUDGE_TEXT, roster); state = r && r.state; }
    catch (err) { state = 'threw: ' + String((err && err.message) || err); }
    const delivered = !!(o.DELIVERY && state === o.DELIVERY.PLACED); // unconfirmed/could_not are not claimed as delivered
    results.push({ session, name: display, act: 'nudge', delivered, because: plan.because, delivery: state });
    if (log) { try { log({ name: display, session, act: 'nudge', delivered, delivery: state, because: plan.because }); } catch { /* never breaks a sweep */ } }
  }
  for (const key of [...book.keys()]) if (!seen.has(key)) book.delete(key); // left the roster
  return { results };
}

/* The default connectivity probe: can this machine open a TCP connection to the API host?
   Resolves true or false, never throws, bounded at 3 s. It proves reachability, not that the
   API will answer, which is enough to decide a retry is worth sending. */
function probeApi({ host = 'api.anthropic.com', port = 443, timeoutMs = 3000 } = {}) {
  const net = require('node:net');
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (done) return; done = true; try { sock.destroy(); } catch { /* already closed */ } resolve(ok); };
    const sock = net.connect({ host, port });
    sock.setTimeout(timeoutMs, () => finish(false));
    sock.once('connect', () => finish(true));
    sock.once('error', () => finish(false));
  });
}

/* #3410: THE one "does the self-heal run" rule, read by the sweep (makeTick) and by the board's
   /api/status (so the page never promises a retry the sweep will not send). Two copies of this
   drifted is the class Convention #5 names; both callers read this one. */
function healEnabled(allowed, env) {
  return allowed === true && (env || process.env).AGENT_WORKFORCE_CONNLOST_HEAL_OFF !== '1';
}

/* The server's per-tick wrapper, separate so its gating is testable: nothing runs unless live
   execution is allowed and the brake is off, a tick never overlaps a slow previous one, and an
   unreadable roster skips the tick. deps = { allowed, env, roster, probe, deliver, DELIVERY, log,
   book, now }. Returns a function; each call returns the in-flight promise or null. */
function makeTick(deps) {
  let busy = false;
  return function tick() {
    try { return tickBody(); } catch { return null; } // best-effort, like the class-1 sweep
  };
  function tickBody() {
    if (!healEnabled(deps.allowed() === true, deps.env)) return null;       // inert under test / before opt-in, or the operator brake
    if (busy) return null;                                                  // a slow probe must not overlap
    let roster;
    try { roster = deps.roster(); } catch { return null; }
    if (!Array.isArray(roster)) return null;
    const now = deps.now ? deps.now() : Date.now(); // before busy, so a throw here cannot wedge it
    busy = true;
    return sweepOnce({
      roster, book: deps.book, now,
      probe: deps.probe, deliver: deps.deliver, DELIVERY: deps.DELIVERY, log: deps.log,
    }).catch((err) => { if (deps.log) { try { deps.log({ name: '-', session: '-', act: 'sweep-error', because: String((err && err.message) || err) }); } catch { /* never breaks */ } } return null; })
      .finally(() => { busy = false; });
  }
}

/*
 * #3410: where the self-heal stands for one connection_lost agent, for the board to say in words.
 * `entry` is this agent's book entry (or undefined before the first sweep has seen it); `enabled`
 * is whether the sweep runs at all (live execution allowed and the operator brake off).
 * Returns null when the sweep is not running (nothing will retry it, so the page must not promise
 * a retry), else { phase, tries }:
 *   'waiting'  - no retry sent yet (the sweep is waiting out the error or for the network)
 *   'retried'  - one or more retries sent in this outage, still under the cap
 *   'gave_up'  - the cap is spent or the entry escalated; a person has to step in
 * Corrupt history counts as used up, matching planHeal.
 */
function reconnectPhase(entry, enabled) {
  if (enabled !== true) return null;
  if (!entry) return { phase: 'waiting', tries: 0 };
  const tries = Array.isArray(entry.nudges) ? entry.nudges.length : MAX_NUDGES;
  if (entry.escalated || tries >= MAX_NUDGES) return { phase: 'gave_up', tries };
  // "retried" only for a retry sent in THIS drop (lostSince), not one kept from an earlier drop.
  // evidence null: the sweep last saw this agent recovered and has not yet seen this drop.
  if (entry.evidence == null) return { phase: 'waiting', tries };
  const since = Number.isFinite(entry.lostSince) ? entry.lostSince : -Infinity;
  const thisDrop = (Array.isArray(entry.nudges) ? entry.nudges : []).filter((t) => Number.isFinite(t) && t >= since).length;
  return thisDrop > 0 ? { phase: 'retried', tries } : { phase: 'waiting', tries };
}

module.exports = { planHeal, observe, sweepOnce, makeTick, probeApi, reconnectPhase, healEnabled, MIN_SWEEPS, MAX_NUDGES, WINDOW_MS, RECOVERED_MS, NUDGE_TEXT };
