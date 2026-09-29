'use strict';

/*
 * #4544: the Prompter nudges the AGENT, not only the person (Josh's Automation spec: "Automatically
 * checks on your agents to ensure they continue working if they have tasks to complete").
 *
 * What was there. The Prompter (engine/heartbeat.js, run by server.js every interval) finds agents
 * in a stall and writes them to the person's check-in (engine/prompternudge.js, Settings'
 * #hb-nudges). The agent-facing half went with #2623 (it rode the phone-home POST) and #3508
 * rebuilt only the person's half. This is the agent's half, local: one message typed into the
 * agent's session through chat.deliver, the board's own typing path (engine/firstreply-nudge.js
 * and engine/connlost-heal.js use it the same way). Nothing leaves the Mac.
 *
 * Who is nudged, all of:
 *  - the Prompter holds an open stall episode for it this tick (heartbeat.step's toAsk). That
 *    already leaves out needs_you (a permission prompt, which needs the person), blocked (the agent
 *    reported it is waiting) and rate_limited;
 *  - its card reads idle, is ours, and is not a switched-off swarm. Only idle: unknown,
 *    auth_failed, connection_lost and stopped cannot act on typed text, and they keep reaching the
 *    person through the check-in;
 *  - it holds an open part of a task in a live project (openParts, the Assigner's hasOpenWork rule).
 *    An agent with none is the Assigner's lane, so the two never both poke one agent;
 *  - none of its open parts was given to it within the last interval, so an agent that was just
 *    told about its work is not told again.
 *
 * How often: one nudge per stall episode. The book entry is dropped when the Prompter's record
 * says the episode closed (the agent worked again, or reported blocked). A delivery that reached
 * nothing is retried on later ticks, up to MAX_TRIES. While Agent Communication's limit is on, nudges
 * across the board are capped at its per-hour number in any hour (a nudge is Kosmos to agent, so
 * there is no pair to charge).
 *
 * The planner is pure; the reads and the delivery are injected, so tests drive it without a pane.
 */

const HOUR_MS = 60 * 60 * 1000;
/* Tries that reached nothing (COULD_NOT, or a throw) before an episode is left alone, as in
   firstreply-nudge.js. */
const MAX_TRIES = 3;
/* The cap on a part's sentence in the typed line, so one long task cannot fill the pane. */
const SENTENCE_CAP = 160;

/* The open parts this agent holds in live projects. The same rule as assigner.hasOpenWork (a closed
   task, or one this agent marked built, holds nothing; agentnudge.test.js holds the two to agreement),
   narrowed to live projects because it must name a part the agent can pick up. */
function openParts(session, projects) {
  const tasks = require('./tasks');
  const out = [];
  for (const p of Array.isArray(projects) ? projects : []) {
    if (!p || p.archived === true) continue;
    for (const t of Array.isArray(p.tasks) ? p.tasks : []) {
      const prog = tasks.progressOf(t);
      if (prog.closed || (t.builtAt && (t.builtFreesAll === true || (Array.isArray(t.builtWho) && t.builtWho.includes(session))))) continue;
      for (const x of prog.parts) {
        if (x.who !== session || x.closedAt) continue;
        out.push({ projectId: p.id, project: typeof p.name === 'string' && p.name ? p.name : p.id, n: t.number, sentence: x.sentence || '', movedAt: x.movedAt || null });
      }
    }
  }
  return out;
}

function nudgeText(part) {
  const s = String(part.sentence || '').replace(/\s+/g, ' ').trim();
  const words = s.length > SENTENCE_CAP ? s.slice(0, SENTENCE_CAP - 3) + '...' : s;
  return 'Kosmos here, from the Prompter: you have been idle while you still have open work: task #' + part.n
    + (words ? ' "' + words + '"' : '') + ' in ' + part.project + '. Pick it up, or if you are waiting on something, '
    + 'say so with: kosmos report blocked --on <what> --owner <who>';
}

/* A card the nudge may type into: ours, idle by the board's reading, not a paused swarm. The same
   test the Assigner's idleCard makes. */
function nudgeableCard(a) {
  return Boolean(a && a.sessionName && a.isNamedOurs === true && a.state === 'idle'
    && !(a.swarm && a.swarm.active === false));
}

/*
 * One agent's decision. card: its roster card; parts: openParts(); entry: its book entry;
 * now: epoch ms; intervalMs: the Prompter's interval.
 * Returns { act: 'none' | 'nudge', because, part? }.
 */
function plan(card, parts, entry, now, intervalMs) {
  if (entry && entry.nudgedAt != null) return { act: 'none', because: 'already nudged in this stall' };
  if (entry && Number.isInteger(entry.tries) && entry.tries >= MAX_TRIES) return { act: 'none', because: 'gave up after ' + MAX_TRIES + ' tries that reached nothing' };
  if (!nudgeableCard(card)) return { act: 'none', because: 'not an idle card of ours' };
  if (!Array.isArray(parts) || !parts.length) return { act: 'none', because: 'no open task in a live project (the Assigner\'s lane)' };
  const fresh = parts.some((x) => { const at = Date.parse(x.movedAt); return Number.isFinite(at) && now - at < intervalMs; });
  if (fresh) return { act: 'none', because: 'was given work within the last interval' };
  return { act: 'nudge', because: 'idle past the interval with open work', part: parts[0] };
}

/*
 * One pass, run by the Prompter's tick. o = { toAsk, next (heartbeat's record map), roster,
 * projects, book (Map session -> entry), sent (array of epoch ms, the board-wide log), now,
 * intervalMs, limit ({ on, perHour }), deliver(session, text, roster), DELIVERY, log }.
 * Returns { results }. Never throws.
 */
function sweepOnce(o) {
  const results = [];
  try {
    if (!o || !Array.isArray(o.roster)) return { results, skipped: 'roster unreadable' };
    const book = o.book instanceof Map ? o.book : new Map();
    const sent = Array.isArray(o.sent) ? o.sent : [];
    const now = Number.isFinite(o.now) ? o.now : Date.now();
    const intervalMs = Number.isFinite(o.intervalMs) && o.intervalMs > 0 ? o.intervalMs : 15 * 60 * 1000;
    const next = o.next instanceof Map ? o.next : new Map();
    const say = (r) => { if (typeof o.log === 'function') { try { o.log(r); } catch { /* never breaks a pass */ } } };
    // An episode that closed (worked again, or reported blocked) frees its agent for the next one.
    for (const session of [...book.keys()]) {
      const rec = next.get(session);
      if (!rec || rec.open !== true) book.delete(session);
    }
    // The board-wide hour, for Agent Communication's limit.
    while (sent.length && now - sent[0] >= HOUR_MS) sent.shift();
    const cap = o.limit && o.limit.on === true && Number.isInteger(o.limit.perHour) ? o.limit.perHour : Infinity;
    const cards = new Map(o.roster.filter((a) => a && a.sessionName).map((a) => [a.sessionName, a]));
    for (const ask of Array.isArray(o.toAsk) ? o.toAsk : []) {
      const session = ask && ask.session;
      const card = session && cards.get(session);
      if (!card) continue;
      const display = card.name || session;
      // One agent's failure is recorded and the pass goes on to the next agent.
      try {
        const entry = book.get(session);
        const p = plan(card, openParts(session, o.projects), entry, now, intervalMs);
        if (p.act !== 'nudge') continue;
        const text = nudgeText(p.part);
        if (sent.length >= cap) { say({ name: display, session, act: 'held', because: 'Agent Communication\'s limit of ' + cap + ' an hour is reached' }); continue; }
        let state = null;
        try { const r = o.deliver(session, text, o.roster); state = r && r.state; }
        catch (err) { state = 'threw: ' + String((err && err.message) || err); }
        const D = o.DELIVERY || {};
        const delivered = D.PLACED != null && state === D.PLACED;
        const mayHaveReached = delivered || (D.UNCONFIRMED != null && state === D.UNCONFIRMED);
        const tries = ((entry && Number.isInteger(entry.tries)) ? entry.tries : 0) + 1;
        book.set(session, { nudgedAt: mayHaveReached ? now : null, tries, delivery: state });
        if (mayHaveReached) sent.push(now);
        results.push({ session, name: display, act: 'nudge', delivered, delivery: state, because: p.because, task: p.part.n });
        say({ name: display, session, act: 'nudge', delivered, delivery: state, because: p.because + ' (task #' + p.part.n + ')' });
      } catch (err) {
        results.push({ session, name: display, act: 'error', because: String((err && err.message) || err) });
      }
    }
  } catch { /* never throws: a pass is best-effort */ }
  return { results };
}

/* THE one "does the agent nudge run" rule: live execution allowed and the operator brake off. */
function nudgeEnabled(allowed, env) {
  return allowed === true && (env || process.env).AGENT_WORKFORCE_AGENT_NUDGE_OFF !== '1';
}

module.exports = { plan, openParts, nudgeText, nudgeableCard, sweepOnce, nudgeEnabled, MAX_TRIES, HOUR_MS };
