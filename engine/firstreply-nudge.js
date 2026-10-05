'use strict';

/*
 * #3226: a one-time reminder to an agent that has not answered its FIRST message.
 *
 * THE DEFECT. About 1 in 10 brand-new agents read the person's first message, write the answer
 * (even the exact `kosmos reply "..."` command) as text, and never run it, so the person sees
 * nothing. The card's probe had turn 1 answering 7 of 8 and turn 2 answering 8 of 8 in the SAME
 * session, and 62 of 71 first turns across 2026-09-17: the fault is concentrated on first contact.
 * The forcing fix (auto-relay the turn, or fail an unsent turn) lives in Claude Code, out of reach.
 * The page's `dmOwesLine` ("Nothing back yet.") does NOT cover this case: it gates on
 * messages.owesReply, which a person's DM never touches (measured 2026-09-28, see the plan).
 *
 * WHAT IT DOES. One message typed into the agent's session through chat.deliver, the board's own
 * typing path (the same way engine/connlost-heal.js recovers a network-wedged agent), telling it
 * to answer with `kosmos reply`. It turns the lost first turn into a second turn, which the probe
 * says is answered.
 *
 * WHEN. Only when all hold (see plan):
 *  - the card reads idle, so nothing is typed over work in progress;
 *  - it is not a switched-off swarm (#4354: its pane refuses the text, and each refusal spends a try);
 *  - its Direct Message thread with the person (chat DIRECT, keyed by sessionName) holds NO row
 *    from the agent at all: a true first contact, never a later turn (Kosmos's daily-limit notice,
 *    written in its name, counts only while it stands: chat.noticeStands);
 *  - the thread's latest row is the PERSON's own message (no `from`), not a numbered-menu answer,
 *    and the board PLACED it in the pane (`delivery.state`), so the text "the person you work for
 *    sent you a message" is true of it;
 *  - that message is at least MIN_QUIET_MS old;
 *  - the book holds no earlier nudge for this session, and fewer than MAX_TRIES tries that
 *    reached nothing. ONE nudge per session per board run, ever.
 *
 * 🛑 WHY THE DIRECT THREAD AND NOT messages.owesReply. The first build keyed on owesReply, and
 * it could not see the case it was written for: the message log holds only agent-to-agent
 * `kosmos msg` rows and room posts. The person's DM is stored in the chat DIRECT thread
 * (server.js, the DM route's chat.appendMessage(chat.DIRECT, ...)), and the agent's
 * `kosmos reply` lands in the same thread (keepAgentReply). So owesReply read `clear` for a
 * person's unanswered first DM, and read `owes` with lastSentAt null for an agent that had
 * answered its person many times but not a colleague: it never fired when it should and would
 * have fired, with false words, when it should not.
 *
 * The planner is PURE and every side effect is injected (the thread reader defaults to the real
 * chat store), so tests drive it without touching a real agent. Nothing here runs by itself:
 * server.js calls it behind the live-execution gate.
 */

const MIN_QUIET_MS = 60 * 1000;
/* Tries that reached nothing (COULD_NOT, or a throw) before this session is left alone for the
   board run. connlost-heal caps its retries the same way; a pane that refuses three times in
   three minutes is not going to be helped by a fourth. */
const MAX_TRIES = 3;
/* #4784: this reminder carries no message text, so it names the verb that reads it back (kosmos inbox).
   Taught bare, like the operator envelope's own "to answer, run: kosmos reply"
   (messages.js operatorDirect), so the reminder names the command the agent was already shown. */
const NUDGE_TEXT = 'Kosmos here, a one-time reminder: the person you work for sent you a message and '
  + 'nothing has reached them yet. Writing an answer here does not send it. To answer them, run: '
  + 'kosmos reply "<your answer>". If their message did not reach you, read it with: kosmos inbox';

/* Has this session's one nudge been spent? A book entry with a nudge time, however it went. */
function nudged(entry) {
  return !!(entry && entry.nudgedAt != null);
}

/* Has this session run out of tries that reached nothing? */
function spent(entry) {
  return !!(entry && Number.isInteger(entry.tries) && entry.tries >= MAX_TRIES);
}

/* The real store: the agent's Direct Message thread with the person. Lazy, so requiring this
   module never loads chat.js. Throws what readThread throws (UNREADABLE, UNPARSEABLE, BAD_THREAD);
   the sweep reads a throw as unknown and does nothing. */
function directThread(session) {
  const chat = require('./chat');
  return chat.readThread(chat.DIRECT, session);
}

/* #4354: the agent's pause from its real profile (swarm.pauseOf). Lazy like directThread. */
function pauseNow(session) {
  return require('./swarm').pauseOf(require('./store').readProfile(session));
}

/*
 * What a DIRECT thread says about first contact. thread is readThread's result ({ messages }) for
 * the agent's sessionName (the key the DM route and keepAgentReply both file under).
 * Returns { state: 'owes' | 'clear' | 'unknown', heardAt, because }.
 *
 * pause is swarm.pauseOf's answer for the agent ({ paused, pausedSince }); absent means running.
 *
 * Who a row is from: a non-empty string `from` is the agent (keepAgentReply writes from: who);
 * an absent or null `from` is the person (readThread's own contract, and chat.dmUnreadAll counts
 * the same way). ANY string `from` counts as the agent, not only its own sessionName: a row we
 * cannot place is never read as "the agent has said nothing", because that is the direction that
 * types false words into a pane. Kosmos's own rows (kind 'kosmos' or 'question') are derived per
 * poll and not stored, but are skipped here too in case one ever is.
 */
function firstContact(thread, pause) {
  if (!thread || !Array.isArray(thread.messages)) return { state: 'unknown', heardAt: null, because: 'the conversation could not be read' };
  /* #4354: Kosmos's daily-limit notice (`kosmos: true`, written in the agent's name) is not the agent answering.
     It counts only while it stands (chat.noticeStands, the rule dmOwes uses): paused now, and written in this
     pause. Once the agent runs again it is ignored, so an unanswered first message is nudged. (The sweep itself
     skips a paused swarm before calling this.) */
  const stands = (m) => require('./chat').noticeStands(m, pause);
  const rows = thread.messages.filter((m) => m && typeof m === 'object' && m.kind !== 'kosmos' && m.kind !== 'question'
    && !(m.kosmos === true && !stands(m)));
  if (rows.some((m) => typeof m.from === 'string' && m.from)) return { state: 'clear', heardAt: null, because: 'has answered the person before; first contact only' };
  const last = rows[rows.length - 1];
  if (!last) return { state: 'clear', heardAt: null, because: 'the person has not written to it' };
  /* A numbered-menu answer (the DM route stores the typed digit in `wire`) is the person answering
     the agent's own question, not a message the nudge's words can describe. */
  if (last.wire != null) return { state: 'clear', heardAt: null, because: 'the latest row is a menu answer, not a message' };
  if (!last.delivery || last.delivery.state !== 'placed') return { state: 'clear', heardAt: null, because: 'the person\'s latest message did not reach the pane' };
  return { state: 'owes', heardAt: typeof last.at === 'string' ? last.at : null, because: null };
}

/*
 * One agent's decision. card is its roster card, fc is firstContact of its DIRECT thread,
 * entry is its book entry (or undefined), now is epoch ms.
 * Returns { act: 'none' | 'wait' | 'nudge', because }.
 */
function plan(card, fc, entry, now) {
  if (nudged(entry)) return { act: 'none', because: 'already reminded once' };
  if (spent(entry)) return { act: 'none', because: 'gave up after ' + MAX_TRIES + ' tries that reached nothing' };
  if (!card || card.state !== 'idle') return { act: 'none', because: 'not idle' };
  if (!fc || fc.state !== 'owes') return { act: 'none', because: (fc && fc.because) || 'owes no first reply' };
  const heard = typeof fc.heardAt === 'string' ? Date.parse(fc.heardAt) : NaN;
  if (!Number.isFinite(heard) || !Number.isFinite(now)) return { act: 'none', because: 'no readable time for the person\'s message' };
  if (now - heard < MIN_QUIET_MS) return { act: 'wait', because: 'the person\'s message is under a minute old' };
  return { act: 'nudge', because: 'idle, the person\'s first message reached it a minute ago, and it has never answered them' };
}

/*
 * One sweep. o = { roster, book (Map session -> entry), now, deliver: (session, text, roster) =>
 * result, DELIVERY, log, thread?, paused? }. paused is (session) => swarm.pauseOf's answer and defaults to
 * the real profile (pauseNow). thread is (session) => readThread result and defaults to the
 * real DIRECT store (directThread); tests inject one only for the planner-shaped cases.
 * Returns { results }. Never throws.
 *
 * The book records a nudge when the delivery PLACED it, and also when it is UNCONFIRMED: by the
 * DELIVERY contract that means the text may have reached the pane, and sending it again may
 * duplicate it. COULD_NOT (nothing reached the pane) or a throw records only a try, and the next
 * sweep tries again, up to MAX_TRIES; then the session is left alone for the board run. Entries are
 * never pruned: one per session per board run is the whole budget.
 */
function sweepOnce(o) {
  const results = [];
  try {
    if (!o || !Array.isArray(o.roster)) return { results, skipped: 'roster unreadable' };
    const book = o.book instanceof Map ? o.book : new Map();
    const now = Number.isFinite(o.now) ? o.now : Date.now();
    const read = typeof o.thread === 'function' ? o.thread : directThread;
    const pauseFor = typeof o.paused === 'function' ? o.paused : pauseNow;
    const log = typeof o.log === 'function' ? o.log : null;
    const say = (r) => { if (log) { try { log(r); } catch { /* never breaks a sweep */ } } };
    for (const card of o.roster) {
      const session = card && card.sessionName;
      if (!session) continue;
      const entry = book.get(session);
      // The cheap conjuncts first, so a thread file is read only for an idle agent still in budget.
      if (nudged(entry) || spent(entry) || card.state !== 'idle') continue;
      /* #4354: a switched-off swarm is left alone before anything is read or tried: its pane refuses the text, and
         each refusal would spend one of MAX_TRIES, leaving it never nudged once it runs again. */
      let pz = null;
      try { pz = pauseFor(session); } catch { pz = null; }
      if (pz && pz.paused === true) continue;
      let fc = null;
      try { fc = firstContact(read(session), pz); } catch { fc = null; }
      const p = plan(card, fc, entry, now);
      if (p.act !== 'nudge') continue;
      const display = card.name || session;
      let state = null;
      let held = false;
      let heldBy = null;   // #4588 ask 3: which hold, so the log does not say "quota" for the Gemini limit
      try { const r = o.deliver(session, NUDGE_TEXT, o.roster); state = r && r.state; held = Boolean(r && r.held === true); heldBy = r && r.heldBy; }
      catch (err) { state = 'threw: ' + String((err && err.message) || err); }
      /* #4588 PR B: held on the shared Google quota, nothing typed: no try is spent, so the nudge still comes after the reset. */
      if (held) { results.push({ session, name: display, act: 'quota-held', delivered: false, delivery: state, because: p.because + (heldBy === 'cap' ? '; held by the Gemini limit' : '; held on the shared Google quota') }); continue; }
      const D = o.DELIVERY || {};
      const delivered = D.PLACED != null && state === D.PLACED;
      const mayHaveReached = delivered || (D.UNCONFIRMED != null && state === D.UNCONFIRMED);
      const tries = ((entry && Number.isInteger(entry.tries)) ? entry.tries : 0) + 1;
      book.set(session, { nudgedAt: mayHaveReached ? now : null, tries, delivery: state });
      const because = (!mayHaveReached && tries >= MAX_TRIES) ? p.because + '; nothing reached the pane in ' + tries + ' tries, so this session is left alone' : p.because;
      results.push({ session, name: display, act: 'nudge', delivered, delivery: state, because });
      // A pane that refuses the text (say a paused swarm) is logged on the first try and when given up on.
      if (mayHaveReached || tries === 1 || tries >= MAX_TRIES) say({ name: display, session, act: 'nudge', delivered, delivery: state, because });
    }
  } catch { /* never throws: a sweep is best-effort */ }
  return { results };
}

/* THE one "does the nudge run" rule: live execution allowed and the operator brake off. */
function nudgeEnabled(allowed, env) {
  return allowed === true && (env || process.env).AGENT_WORKFORCE_FIRSTREPLY_NUDGE_OFF !== '1';
}

/* The server's per-tick wrapper, separate so its gating is testable. deps = { allowed, env, paused?,
   roster, deliver, DELIVERY, log, book, now, thread? }. Each call returns the sweep's result, or
   null when it did not run. Never throws. */
function makeTick(deps) {
  return function tick() {
    try {
      if (!nudgeEnabled(deps.allowed() === true, deps.env)) return null; // inert under test / before opt-in, or the brake
      const roster = deps.roster();
      if (!Array.isArray(roster)) return null;
      return sweepOnce({
        roster, book: deps.book, now: deps.now ? deps.now() : Date.now(),
        thread: deps.thread, paused: deps.paused, deliver: deps.deliver, DELIVERY: deps.DELIVERY, log: deps.log,
      });
    } catch { return null; }
  };
}

module.exports = { plan, firstContact, directThread, sweepOnce, makeTick, nudgeEnabled, MIN_QUIET_MS, MAX_TRIES, NUDGE_TEXT };
