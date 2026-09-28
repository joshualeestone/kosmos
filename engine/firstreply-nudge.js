'use strict';

/*
 * #3226: a one-time reminder to an agent that has not answered its FIRST message.
 *
 * THE DEFECT. About 1 in 10 brand-new agents read the person's first message, write the answer
 * (even the exact `kosmos reply "..."` command) as text, and never run it, so the person sees
 * nothing. The card's probe had turn 1 answering 7 of 8 and turn 2 answering 8 of 8 in the SAME
 * session, and 62 of 71 first turns across 2026-09-17: the fault is concentrated on first contact.
 * The forcing fix (auto-relay the turn, or fail an unsent turn) lives in Claude Code, out of reach.
 * `dmOwesLine` on the page already says "Nothing back yet." after 2 minutes; this is the other half.
 *
 * WHAT IT DOES. One message typed into the agent's session through chat.deliver, the board's own
 * typing path (the same way engine/connlost-heal.js recovers a network-wedged agent), telling it
 * to answer with `kosmos reply`. It turns the lost first turn into a second turn, which the probe
 * says is answered.
 *
 * WHEN. Only when all hold (see plan):
 *  - the card reads idle, so nothing is typed over work in progress;
 *  - messages.owesReply says it owes a reply ('owes');
 *  - it has never sent anything at all (lastSentAt null): first contact only, never later turns;
 *  - the message it owes was heard at least MIN_QUIET_MS ago;
 *  - the book holds no earlier nudge for this session. ONE nudge per session per board run, ever.
 *
 * The planner is PURE and every side effect is injected, so tests drive it without touching a
 * real agent. Nothing here runs by itself: server.js calls it behind the live-execution gate.
 */

const MIN_QUIET_MS = 60 * 1000;
/* Taught bare, like the operator envelope's own "to answer, run: kosmos reply"
   (messages.js operatorDirect), so the reminder names the command the agent was already shown. */
const NUDGE_TEXT = 'Kosmos here, a one-time reminder: the person you work for sent you a message and '
  + 'nothing has reached them yet. Writing an answer here does not send it. To answer them, run: '
  + 'kosmos reply "<your answer>"';

/* Has this session's one nudge been spent? A book entry with a nudge time, however it went. */
function nudged(entry) {
  return !!(entry && entry.nudgedAt != null);
}

/*
 * One agent's decision. card is its roster card, owes is messages.owesReply(card.sessionName),
 * entry is its book entry (or undefined), now is epoch ms.
 * Returns { act: 'none' | 'wait' | 'nudge', because }.
 */
function plan(card, owes, entry, now) {
  if (nudged(entry)) return { act: 'none', because: 'already reminded once' };
  if (!card || card.state !== 'idle') return { act: 'none', because: 'not idle' };
  if (!owes || owes.state !== 'owes') return { act: 'none', because: 'owes no reply' };
  if (owes.lastSentAt != null) return { act: 'none', because: 'has replied before; first contact only' };
  const heard = Date.parse(owes.lastHeardAt);
  if (!Number.isFinite(heard) || !Number.isFinite(now)) return { act: 'none', because: 'no readable time for the owed message' };
  if (now - heard < MIN_QUIET_MS) return { act: 'wait', because: 'the owed message is under a minute old' };
  return { act: 'nudge', because: 'idle, owes its first reply, has never sent one, and has been quiet a minute' };
}

/*
 * One sweep. o = { roster, book (Map session -> entry), now, owes: (session) => owesReply result,
 * deliver: (session, text, roster) => result, DELIVERY, log }. Returns { results }. Never throws.
 *
 * The book records a nudge when the delivery PLACED it, and also when it is UNCONFIRMED: by the
 * DELIVERY contract that means the text may have reached the pane, and sending it again may
 * duplicate it. COULD_NOT (nothing reached the pane) or a throw records only a try, so the next
 * sweep tries again. Entries are never pruned: one per session per board run is the whole budget.
 */
function sweepOnce(o) {
  const results = [];
  try {
    if (!o || !Array.isArray(o.roster)) return { results, skipped: 'roster unreadable' };
    const book = o.book instanceof Map ? o.book : new Map();
    const now = Number.isFinite(o.now) ? o.now : Date.now();
    const log = typeof o.log === 'function' ? o.log : null;
    const say = (r) => { if (log) { try { log(r); } catch { /* never breaks a sweep */ } } };
    for (const card of o.roster) {
      const session = card && card.sessionName;
      if (!session) continue;
      const entry = book.get(session);
      // The cheap conjuncts first, so the message log is read only for an idle, un-nudged agent.
      if (nudged(entry) || card.state !== 'idle') continue;
      let owes = null;
      try { owes = o.owes(session); } catch { owes = null; }
      const p = plan(card, owes, entry, now);
      if (p.act !== 'nudge') continue;
      const display = card.name || session;
      let state = null;
      try { const r = o.deliver(session, NUDGE_TEXT, o.roster); state = r && r.state; }
      catch (err) { state = 'threw: ' + String((err && err.message) || err); }
      const D = o.DELIVERY || {};
      const delivered = D.PLACED != null && state === D.PLACED;
      const mayHaveReached = delivered || (D.UNCONFIRMED != null && state === D.UNCONFIRMED);
      const tries = ((entry && Number.isInteger(entry.tries)) ? entry.tries : 0) + 1;
      book.set(session, { nudgedAt: mayHaveReached ? now : null, tries, delivery: state });
      results.push({ session, name: display, act: 'nudge', delivered, delivery: state, because: p.because });
      // A pane that refuses the text (say a paused swarm) is retried every sweep; log it once.
      if (mayHaveReached || tries === 1) say({ name: display, session, act: 'nudge', delivered, delivery: state, because: p.because });
    }
  } catch { /* never throws: a sweep is best-effort */ }
  return { results };
}

/* THE one "does the nudge run" rule: live execution allowed and the operator brake off. */
function nudgeEnabled(allowed, env) {
  return allowed === true && (env || process.env).AGENT_WORKFORCE_FIRSTREPLY_NUDGE_OFF !== '1';
}

/* The server's per-tick wrapper, separate so its gating is testable. deps = { allowed, env,
   roster, owes, deliver, DELIVERY, log, book, now }. Each call returns the sweep's result, or
   null when it did not run. Never throws. */
function makeTick(deps) {
  return function tick() {
    try {
      if (!nudgeEnabled(deps.allowed() === true, deps.env)) return null; // inert under test / before opt-in, or the brake
      const roster = deps.roster();
      if (!Array.isArray(roster)) return null;
      return sweepOnce({
        roster, book: deps.book, now: deps.now ? deps.now() : Date.now(),
        owes: deps.owes, deliver: deps.deliver, DELIVERY: deps.DELIVERY, log: deps.log,
      });
    } catch { return null; }
  };
}

module.exports = { plan, sweepOnce, makeTick, nudgeEnabled, MIN_QUIET_MS, NUDGE_TEXT };
