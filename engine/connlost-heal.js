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
 *    SAME evidence line each time. A live retry line changes every second (its countdown), so an
 *    unmeasured retry shape that status.js still misreads as connection_lost cannot pass this;
 *  - a connectivity probe succeeds (the caller's `probe`), so a nudge is not wasted while the
 *    network is still down;
 *  - fewer than MAX_NUDGES nudges inside WINDOW_MS. Past that it ESCALATES: no more nudges, a log
 *    line, and the card stays connection_lost, which heartbeat already surfaces to a person.
 *
 * The planner is PURE and the executor is injected, so tests drive both without touching a real
 * agent. Nothing here runs by itself: server.js calls sweepOnce behind the live-execution gate.
 */

const MIN_SWEEPS = 2;
const MAX_NUDGES = 3;
const WINDOW_MS = 30 * 60 * 1000;
// A nudge makes Claude Code retry, and a retry reads WORKING, so a short spell of not-lost is
// not a recovery. History (nudges, escalation) is dropped only after this much time not lost.
const RECOVERED_MS = 10 * 60 * 1000;
const NUDGE_TEXT = 'Your connection to the API is back. Please retry what you were doing.';

/*
 * One agent's decision. `entry` is this agent's book entry ({ evidence, sweeps, nudges[] }) as it
 * stands AFTER this sweep's observation was folded in (see observe). Returns
 * { act: 'none' | 'wait' | 'nudge' | 'escalate', because }.
 */
function planHeal(entry, now, probeOk) {
  if (!entry || entry.evidence == null) return { act: 'none', because: 'not connection_lost' };
  // Escalation is sticky until a sustained recovery clears the entry: a window rolling over
  // must not restart the nudges on an agent that three nudges did not fix.
  if (entry.escalated) return { act: 'escalate', because: 'already escalated; waiting for a person or a real recovery' };
  const nudges = Array.isArray(entry.nudges) ? entry.nudges : null;
  const nowBad = !Number.isFinite(now);
  // Corrupt history counts as fully used, so it escalates rather than nudging again.
  const recent = nudges === null ? MAX_NUDGES
    : nudges.filter((t) => nowBad || !Number.isFinite(t) || (now - t) < WINDOW_MS).length;
  if (recent >= MAX_NUDGES) {
    return { act: 'escalate', because: `nudged ${recent} time(s) within ${WINDOW_MS}ms and it is still connection_lost` };
  }
  if (!(Number.isInteger(entry.sweeps) && entry.sweeps >= MIN_SWEEPS)) {
    return { act: 'wait', because: `connection_lost on ${entry.sweeps} sweep(s); waiting for ${MIN_SWEEPS} with the same error line` };
  }
  if (probeOk !== true) return { act: 'wait', because: 'the network is still unreachable, so a retry would fail again' };
  return { act: 'nudge', because: 'connection_lost persisted with the same error line and the network is reachable again' };
}

/* Fold one sweep's reading of an agent into its book entry. A different evidence line restarts
   the count, so only a pane that has not changed can reach MIN_SWEEPS. */
function observe(prev, evidence) {
  const nudges = prev && Array.isArray(prev.nudges) ? prev.nudges : (prev ? prev.nudges : []);
  const escalated = !!(prev && prev.escalated); // log an escalation once per loss, not every sweep
  if (prev && prev.evidence === evidence) return { evidence, sweeps: (prev.sweeps || 0) + 1, nudges, escalated, okSince: null };
  return { evidence, sweeps: 1, nudges, escalated, okSince: null };
}

/*
 * One sweep. o = { roster, book (Map session -> entry), now, probe: () => Promise<boolean>,
 * deliver: (session, text, roster) => result, DELIVERY, log }. Returns { results }.
 * The probe runs at most once per sweep, and only when some agent is ready to be nudged.
 */
async function sweepOnce(o) {
  const book = (o && o.book instanceof Map) ? o.book : new Map();
  const roster = (o && Array.isArray(o.roster)) ? o.roster : [];
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
      // after RECOVERED_MS of not being lost.
      const okSince = Number.isFinite(prev.okSince) ? prev.okSince : now;
      if (now - okSince >= RECOVERED_MS) { book.delete(session); continue; }
      book.set(session, { ...prev, evidence: null, sweeps: 0, okSince });
      continue;
    }
    const entry = observe(book.get(session), agent.stateEvidence);
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
    if (log) { try { log({ name: display, session, act: 'nudge', delivered, because: plan.because }); } catch { /* never breaks a sweep */ } }
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

module.exports = { planHeal, observe, sweepOnce, probeApi, MIN_SWEEPS, MAX_NUDGES, WINDOW_MS, RECOVERED_MS, NUDGE_TEXT };
