'use strict';

/*
 * #3492: the "Write a handoff, then restart" option on the restart confirm
 * dialog (Josh, 2026-09-23). The plain restart forgets everything the agent was
 * doing; this option asks the agent to write a handoff FIRST, waits for it, then
 * restarts, and points the fresh session at that handoff so it picks up cleanly.
 *
 * THIS MODULE IS THE PURE CORE: the two prompt texts and the one freshness
 * decision. It does no I/O. The server wires the real deps (chat.deliver, the
 * handoff path, the file's mtime, removal.restart) and the client orchestrates
 * the phases; keeping the decision pure is what lets it be tested without a real
 * agent, a real clock, or a real disk -- the same split autohandoff.js and
 * class1-autohandle.js use.
 *
 * WHY IT REUSES THE EXISTING MACHINERY rather than inventing a parallel one:
 *  - The handoff CONTENTS are autohandoff.HANDOFF_CONTENTS -- one contract for
 *    what a handoff must contain, so this option and the auto-handoff sweep ask
 *    for the same thing (a second copy of that list is the defect this avoids).
 *  - The delivery of both prompts rides chat.deliver (the same PLACED /
 *    UNCONFIRMED / COULD_NOT verdict every send in this app returns), so a
 *    prompt that did not land is KNOWN, not assumed. The client proceeds to the
 *    restart only on a PLACED handoff prompt AND a confirmed-fresh handoff file
 *    -- an unconfirmed ask or an unwritten handoff must NOT lose the agent's
 *    context to a restart (a mistimed destructive action is worse than making
 *    the person choose).
 *  - The PICKUP after the restart is the existing post-restart wake path
 *    (restartReadyWait + a delivery once the fresh session is up), with the
 *    message swapped from "hello" to pickupPrompt(path). There already IS a
 *    post-restart delivery; #3492 only changes what it says.
 */

const autohandoff = require('./autohandoff');

/*
 * The prompt delivered to the LIVE agent, before we restart it. It reuses the
 * handoff contract (autohandoff.HANDOFF_CONTENTS) so the contents match the
 * auto-handoff sweep's, but the opening and closing are INVERTED from the
 * fill-triggered prompt: there is no context-fill percentage (the trigger is an
 * explicit restart, not pressure), and the agent must NOT keep working -- the
 * restart happens the moment the handoff is written, so anything it starts after
 * is lost.
 *
 * (Delivery via chat.deliver/cleanMessage collapses whitespace to single spaces,
 * so the agent receives one line; the newline layout is for source readability,
 * as in autohandoff.handoffPrompt.)
 */
function handoffForRestartPrompt(path) {
  return [
    'You are about to be restarted, and a fresh session will read this handoff to continue your'
      + ' work. Write your handoff now to ' + path + ' (refresh it if it already exists), covering:',
    ...autohandoff.HANDOFF_CONTENTS,
    'Write to the path, not into a message (messages truncate). Do this now, and do NOT keep'
      + ' working after it: the restart happens as soon as the handoff is written.',
  ].join('\n');
}

/*
 * The pickup message delivered to the FRESH session once it is back up, in place
 * of the plain restart's "hello". It points the new session at the handoff the
 * old one just wrote, so it continues rather than starting cold.
 */
function pickupPrompt(path) {
  return 'You were just restarted to continue earlier work. Read your handoff at ' + path
    + ' first, then continue from where it says. It has your branch and sha, what was done versus'
    + ' merely claimed, and the ordered next steps.';
}

/*
 * Has the handoff been (re)written since we asked for it? `before` and `after`
 * are snapshots of the handoff file: { exists:boolean, mtimeMs:number|null }.
 * Fresh means the file now exists AND either it did not before (it appeared) or
 * its mtime advanced (it was rewritten). This is the gate the client polls on
 * before it restarts: only a confirmed-fresh handoff lets a restart proceed.
 *
 * The two cases:
 *  - APPEARED (did not exist before, exists now): fresh. The appearance itself
 *    is the evidence of a write; its mtime need not be readable.
 *  - EXISTED before: fresh only if its mtime ADVANCED. ⚠️ CONSERVATIVE HERE --
 *    if the file existed before and its time now is not a readable number, we
 *    return false, because an unreadable new time is not evidence of a NEW write
 *    over an existing file, and the safe direction is to keep waiting / fall to
 *    the person rather than restart (and lose context) on a maybe. If the file
 *    existed before with an unreadable time but now has a readable one, that IS
 *    evidence of a write, so it reads fresh.
 *
 * ⚠️ `Number(null)` is 0 (finite), so a null mtime is filtered explicitly via
 * `finiteMs` rather than trusted to Number.isFinite alone -- that miss is what a
 * red control on the null-mtime case catches.
 */
function finiteMs(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function handoffIsFresh(before, after) {
  if (!after || after.exists !== true) return false;
  if (!before || before.exists !== true) return true;   // it appeared
  const a = finiteMs(after.mtimeMs);
  if (a === null) return false;                          // existed before, no readable new time
  const b = finiteMs(before.mtimeMs);
  if (b === null) return true;                           // was there, unreadable then, readable now
  return a > b;                                          // it was rewritten
}

module.exports = { handoffForRestartPrompt, pickupPrompt, handoffIsFresh };
