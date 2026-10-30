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
 *    reached nothing. ONE nudge per session per board run, ever;
 *  - the agent has not declared another channel it answers the person on (kosmos#5805 part 2,
 *    `kosmos reply-channel`): an answer there is out of Kosmos's sight.
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
  + 'kosmos reply "<your answer>". If their message did not reach you, read it with: kosmos inbox. '
  /* kosmos#5805 part 2: the agent in the report was told to answer elsewhere and had no way to learn the opt-out;
     this reminder is the moment it is needed, and it says what the command is not for. */
  + 'Only if your instructions say to answer them somewhere else: answer there, then run kosmos reply-channel "<where>" '
  + '(it stops this reminder for good, so never run it just to quiet it)';

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
  if (spent(entry)) return { act: 'none', gaveUp: true, because: 'gave up after ' + MAX_TRIES + ' tries that reached nothing' };   // #5154 slice B: gaveUp lets the sweep surface this on the board
  if (!card || card.state !== 'idle') return { act: 'none', because: 'not idle' };
  /* #5949: a remembered idle (held through a failed look) is not evidence it is idle now; typing into the pane waits a
     few seconds for a fresh look, as the Assigner and the limit release do. */
  if (require('./status').stateIsRemembered(card)) return { act: 'none', because: 'its idle is remembered, not a fresh look' };
  if (!fc || fc.state !== 'owes') return { act: 'none', because: (fc && fc.because) || 'owes no first reply' };
  const heard = typeof fc.heardAt === 'string' ? Date.parse(fc.heardAt) : NaN;
  if (!Number.isFinite(heard) || !Number.isFinite(now)) return { act: 'none', because: 'no readable time for the person\'s message' };
  if (now - heard < MIN_QUIET_MS) return { act: 'wait', because: 'the person\'s message is under a minute old' };
  return { act: 'nudge', because: 'idle, the person\'s first message reached it a minute ago, and it has never answered them' };
}

/*
 * One sweep. o = { roster, book (Map session -> entry), now, deliver: (session, text, roster) =>
 * result, DELIVERY, log, thread?, paused?, replyChannel? }. paused is (session) => swarm.pauseOf's answer and defaults to
 * the real profile (pauseNow); replyChannel is (session) => the declared channel or null (kosmos#5805 part 2) and
 * defaults to the real profile too (replychannel.forAgent). thread is (session) => readThread result and defaults to the
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
    const channelFor = typeof o.replyChannel === 'function' ? o.replyChannel : (s) => require('./replychannel').forAgent(s);
    const log = typeof o.log === 'function' ? o.log : null;
    const say = (r) => { if (log) { try { log(r); } catch { /* never breaks a sweep */ } } };
    // #5154 slice B: the give-up SIGNAL to the board (ownbounds), SEPARATE from `say`/`log`. Fires every sweep
    // the agent is given up (keeps the board's staleness clock fresh); writes no stdout. Optional: unset in tests.
    const bound = typeof o.bound === 'function' ? o.bound : null;
    // #5154 slice B: the RECOVERY signal. A spent book entry is NEVER deleted on its own, so if the agent
    // answers its first message by another route (a reply-channel, out of Kosmos's sight) the entry stays spent
    // forever. Without this, `bound` would fire every sweep on a healthy idle agent that no longer owes a reply.
    const cleared = typeof o.cleared === 'function' ? o.cleared : null;
    for (const card of o.roster) {
      const session = card && card.sessionName;
      if (!session) continue;
      const entry = book.get(session);
      // The cheap conjuncts first, so a thread file is read only for an idle agent still in budget. Split from
      // the original single `continue` so the give-up case can be surfaced -- the control flow is identical
      // (each arm still continues); only the #5154-B say is new.
      if (nudged(entry)) continue;                        // already reminded once: not a give-up
      if (spent(entry)) {
        // #5154 slice B: gave up reminding this agent. But the give-up is REAL only while the agent STILL owes
        // its first reply: the book entry is not deleted when the obligation resolves, so an agent that answered
        // by another route stays spent. So read firstContact here (the same owes-check the nudge path uses) and
        // raise via `bound` ONLY while it still owes. If it no longer owes, the give-up is resolved -- clear the
        // episode (`cleared`) and DROP the stale entry so the sweep stops re-raising it. Only while idle; a
        // non-idle agent's give-up is mooted on the board (isMoot). `bound` writes no stdout (unlike `say`).
        if (card.state === 'idle') {
          let pzS = null;
          try { pzS = pauseFor(session); } catch { pzS = null; }
          if (pzS && pzS.paused === true) {
            // #4354: a switched-off swarm -- the normal path leaves it alone. Neither raise nor clear: it may
            // come back owing, so do not drop the episode; the STALE_MS backstop covers a persistent pause.
          } else {
            let declaredS = null;
            try { declaredS = channelFor(session); } catch { declaredS = null; }
            if (declaredS) {
              // #5805: the agent answers its person on a declared reply-channel, out of Kosmos's sight -- the
              // normal path never nudges it, so a give-up is moot. Resolve it: clear and drop the stale entry.
              book.delete(session);
              if (cleared) { try { cleared(session); } catch { /* best-effort */ } }
            } else {
              let fcS = null;
              try { fcS = firstContact(read(session), pzS); } catch { fcS = null; }
              if (fcS && fcS.state === 'owes') {
                if (bound) { try { bound(session, 'gave up after ' + MAX_TRIES + ' tries that reached nothing'); } catch { /* best-effort */ } }
              } else if (fcS && fcS.state === 'clear') {
                // DEFINITELY no longer owes: resolved -- clear the episode and drop the stale spent entry. Only on
                // a definite 'clear': an INDETERMINATE read (fcS null = the thread read threw, or 'unknown' =
                // unreadable) must NEITHER raise nor clear -- clearing on uncertainty would drop a possibly-real
                // give-up AND re-arm the nudge (breaking "one nudge ever"). The indeterminate case leaves the
                // entry and relies on the STALE_MS backstop, matching isMoot's refusal to moot on 'unknown'.
                book.delete(session);
                if (cleared) { try { cleared(session); } catch { /* best-effort */ } }
              }
            }
          }
        }
        continue;
      }
      if (card.state !== 'idle' || require('./status').stateIsRemembered(card)) continue;   // #5949: a remembered idle is not a fresh look
      /* #4354: a switched-off swarm is left alone before anything is read or tried: its pane refuses the text, and
         each refusal would spend one of MAX_TRIES, leaving it never nudged once it runs again. */
      let pz = null;
      try { pz = pauseFor(session); } catch { pz = null; }
      if (pz && pz.paused === true) continue;
      let fc = null;
      try { fc = firstContact(read(session), pz); } catch { fc = null; }
      const p = plan(card, fc, entry, now);
      if (p.act !== 'nudge') continue;
      /* kosmos#5805 part 2: an agent that declared where it answers the person (kosmos reply-channel) may have answered
         there, out of Kosmos's sight, so "nothing has reached them yet" would be a guess. It is never nudged. Read only
         once a nudge is due, so a sweep does not read every profile. Only the channel last logged is booked (never a
         nudge or a try), so an agent that clears its channel is reminded of a first message still unanswered on the
         next sweep, as one that never declared is. The first skip per channel is logged, so a person asking why an
         agent was never reminded finds the answer in the log. */
      let declared = null;
      try { declared = channelFor(session); } catch { declared = null; }
      if (declared) {
        if (!entry || entry.declaredSaid !== declared) {
          book.set(session, { ...(entry || {}), declaredSaid: declared });
          say({ name: card.name || session, session, act: 'declared', delivered: false, delivery: null, because: 'it answers its person on ' + declared + ' (kosmos reply-channel), out of Kosmos\'s sight' });
        }
        continue;
      }
      const display = card.name || session;
      let state = null;
      let held = false;
      let heldBy = null;   // #4588 ask 3: which hold, so the log does not say "quota" for the Gemini limit
      try { const r = o.deliver(session, NUDGE_TEXT, o.roster); state = r && r.state; held = Boolean(r && r.held === true); heldBy = r && (r.heldFor === 'signin' ? 'signin' : r.heldBy); }
      catch (err) { state = 'threw: ' + String((err && err.message) || err); }
      /* #4588 PR B: held (the shared Google quota, the Gemini cap, #5743 an answer awaited on its screen, or #5805 a usage limit), nothing typed: no try is spent, so the nudge still comes after the reset. */
      if (held) { results.push({ session, name: display, act: heldBy === 'input' ? 'input-held' : heldBy === 'menu' ? 'menu-held' : heldBy === 'signin' ? 'signin-held' : heldBy === 'limit' ? 'limit-held' : 'quota-held', delivered: false, delivery: state, because: p.because + (heldBy === 'input' ? '; held while its input box holds text not yet sent (#6249)' : heldBy === 'cap' ? '; held by a working-at-once limit you set' : heldBy === 'menu' ? '; held while it waits for an answer on its screen' : heldBy === 'signin' ? '; held while it is signed out (#5948)' : heldBy === 'limit' ? '; held while it is out of usage (#5805)' : '; held on the shared Google quota') }); continue; }
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
   roster, deliver, DELIVERY, log, book, now, thread?, replyChannel? }. Each call returns the sweep's result, or
   null when it did not run. Never throws. */
function makeTick(deps) {
  return function tick() {
    try {
      if (!nudgeEnabled(deps.allowed() === true, deps.env)) return null; // inert under test / before opt-in, or the brake
      const roster = deps.roster();
      if (!Array.isArray(roster)) return null;
      return sweepOnce({
        roster, book: deps.book, now: deps.now ? deps.now() : Date.now(),
        thread: deps.thread, paused: deps.paused, replyChannel: deps.replyChannel, deliver: deps.deliver, DELIVERY: deps.DELIVERY, log: deps.log, bound: deps.bound, cleared: deps.cleared,   // #5154 slice B: give-up + recovery -> board
      });
    } catch { return null; }
  };
}

module.exports = { plan, firstContact, directThread, sweepOnce, makeTick, nudgeEnabled, MIN_QUIET_MS, MAX_TRIES, NUDGE_TEXT };
