'use strict';

/*
 * #4588: resume Antigravity (agy) agents after their Google account's shared quota resets.
 *
 * Every agy agent on a machine signs in to the same Google account (agy's sign-in is machine-wide), so they share
 * one quota. When it runs out, agy ends the turn with RESOURCE_EXHAUSTED ... "Resets in 24m54s", and
 * bin/agy-report-bridge.js reports an automatic idle whose `until` is that reset as an ISO time (status.js reads it
 * as Paused until then; see quotaPauseUntil). This sweep types one carry-on line into each such agent after its
 * reset has passed, the connlost-heal pattern (#3410): a nudge keeps the agent's in-flight context, a restart
 * would lose it.
 *
 * ONE AT A TIME: at most one agent per sweep, and at least STAGGER_MS after the last one, so agents on one account
 * do not all hit the refreshed quota in the same second and use it up together (the card's second complaint).
 * Oldest reset first. At most MAX_TRIES tries per agent per pause; a pause is one `until`, so an agent that hits
 * the quota again after resuming starts a new one.
 *
 * The planner is pure and the delivery is injected, so tests drive both without touching a real agent. Nothing
 * here runs by itself: server.js calls the tick behind the live-execution gate and the operator brake
 * AGENT_WORKFORCE_AGY_QUOTA_RESUME_OFF=1.
 */

const GRACE_MS = 30 * 1000;
/* A little under the server's 60 s tick, so jitter between ticks cannot turn one minute's spacing into two (review 1). */
const STAGGER_MS = 55 * 1000;
/* A reset older than this is left alone: the book lives in memory, so without it every board restart would type the
   carry-on line again into an agent whose last report is still an old quota stop (review 1). Google's allowance
   refreshes every five hours. */
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const MAX_TRIES = 3;
const NUDGE_TEXT = 'The Google quota for this account has reset. Please carry on with what you were doing.';
const LAST = '__lastNudgeAt';

/* The reset an agent is paused until, from its latest report, in epoch ms; null when it is not paused on the
   quota. The same shape status.quotaPauseUntil reads, without its "still ahead" condition. */
function pausedUntil(report) {
  if (!report || report.found !== true || report.state !== 'idle' || report.by !== 'auto') return null;
  const at = typeof report.until === 'string' ? Date.parse(report.until) : NaN;
  return Number.isFinite(at) ? at : null;
}

/* One agent: { act: 'none' | 'wait' | 'nudge', because }. entry is its book entry for this pause, or undefined. */
function plan(report, entry, now) {
  const at = pausedUntil(report);
  if (at === null) return { act: 'none', because: 'not paused on the quota' };
  if (entry && entry.until === report.until) {
    if (entry.nudgedAt != null) return { act: 'none', because: 'already resumed once for this reset' };
    if ((entry.tries || 0) >= MAX_TRIES) return { act: 'none', because: 'gave up after ' + MAX_TRIES + ' tries that reached nothing' };
  }
  if (now < at + GRACE_MS) return { act: 'wait', because: 'its quota resets at ' + new Date(at).toISOString() };
  if (now > at + MAX_AGE_MS) return { act: 'none', because: 'its quota reset more than six hours ago; left alone' };
  return { act: 'nudge', because: 'its quota reset at ' + new Date(at).toISOString() };
}

/*
 * One sweep. o = { roster, book (Map), now, readReport (session) => selfreport.read shape, deliver (session, text,
 * roster) => result, DELIVERY, log }. Nudges at most one agent. Returns { results }. Never throws.
 */
function sweepOnce(o) {
  const results = [];
  try {
    if (!o || !Array.isArray(o.roster)) return { results, skipped: 'roster unreadable' };
    const book = o.book instanceof Map ? o.book : new Map();
    const now = Number.isFinite(o.now) ? o.now : Date.now();
    const read = typeof o.readReport === 'function' ? o.readReport : (s) => require('./selfreport').read(s);
    const log = typeof o.log === 'function' ? o.log : null;
    const last = book.get(LAST);
    if (Number.isFinite(last) && now - last < STAGGER_MS) return { results, skipped: 'spacing resumes out' };
    const due = [];
    for (const card of o.roster) {
      const session = card && card.sessionName;
      if (!session || card.runner !== 'antigravity') continue;
      let report = null;
      try { report = read(session); } catch { report = null; }
      const entry = book.get(session);
      const p = plan(report, entry, now);
      if (p.act === 'nudge') due.push({ card, session, report, entry, because: p.because, at: pausedUntil(report) });
    }
    if (!due.length) return { results };
    due.sort((a, b) => (a.at - b.at) || String(a.session).localeCompare(String(b.session)));
    const d = due[0];
    let state = null;
    try { const r = o.deliver(d.session, NUDGE_TEXT, o.roster); state = r && r.state; }
    catch (err) { state = 'threw: ' + String((err && err.message) || err); }
    const D = o.DELIVERY || {};
    const delivered = D.PLACED != null && state === D.PLACED;
    const mayHaveReached = delivered || (D.UNCONFIRMED != null && state === D.UNCONFIRMED);
    const tries = (d.entry && d.entry.until === d.report.until && Number.isInteger(d.entry.tries) ? d.entry.tries : 0) + 1;
    book.set(d.session, { until: d.report.until, nudgedAt: mayHaveReached ? now : null, tries, delivery: state });
    book.set(LAST, now);
    const r = { session: d.session, name: d.card.name || d.session, act: 'nudge', delivered, delivery: state, because: d.because, waiting: due.length - 1 };
    results.push(r);
    if (log) { try { log(r); } catch { /* never breaks a sweep */ } }
  } catch { /* never throws: a sweep is best-effort */ }
  return { results };
}

/* The one "does the resume run" rule: live execution allowed and the operator brake off. */
function resumeEnabled(allowed, env) {
  return allowed === true && (env || process.env).AGENT_WORKFORCE_AGY_QUOTA_RESUME_OFF !== '1';
}

/* The server's per-tick wrapper. deps = { allowed, env, roster, readReport?, deliver, DELIVERY, log, book, now? }. */
function makeTick(deps) {
  return function tick() {
    try {
      if (!resumeEnabled(deps.allowed() === true, deps.env)) return null;
      const roster = deps.roster();
      if (!Array.isArray(roster)) return null;
      return sweepOnce({ roster, book: deps.book, now: deps.now ? deps.now() : Date.now(), readReport: deps.readReport, deliver: deps.deliver, DELIVERY: deps.DELIVERY, log: deps.log });
    } catch { return null; }
  };
}

module.exports = { GRACE_MS, STAGGER_MS, MAX_AGE_MS, MAX_TRIES, NUDGE_TEXT, pausedUntil, plan, sweepOnce, resumeEnabled, makeTick };
