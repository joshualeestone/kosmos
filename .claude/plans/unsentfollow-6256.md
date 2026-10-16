# unsentfollow-6256: follow-ups from the #6249 review rounds (an unsent line in an idle agent's input box)

Stacked on msgsubmit-6249 (0b5088a133, Sonya's #6249, not merged yet); rebased onto main when it merges. Splinter
routed it 2026-10-15 17:05. Finished looks like: each of the card's 11 items fixed or closed with a reason.

## Fixed
1. **Room posts held by text in the box.** messages.js notes the post (roomhold.noteInput: member, project, id) when it
   is held with heldBy 'input'. roomhold.flushReleased (the once-a-minute sweep) then tells only the projects still
   holding a noted post, once chat.inputBoxEmpty(card) reads the box empty, the member is not in a fresh working turn,
   is addressable, and no usage limit or sign-out holds it (accountHeldVerdict). Notes for posts told another way are
   dropped, so they wake nobody. Kept in memory: after a restart these wait for the next wake, as before. The server
   log line says "once its input box was empty".
   Rejected: flushing when the card's unsentInput clears (it only shows after 3 minutes, so a box cleared sooner never
   set it).
2. **The record.** Each remembered line has a number (unsentSeq on its verdict). messages.js keeps message rows marked
   unsubmitted by that number. When a later delivery presses Enter on the line and the box empties, chat calls a hook,
   and messages appends `{ kind: 'unsent-submitted', of: <id>, from, to, at }`. The reader accepts the new kind, as it
   does held-delivered. A line some other sender left (a nudge, a room post) has no message row and writes nothing.
   `earlierSubmitted` stays on the verdict (tests read it).
3. **The sentence** now says Kosmos tries to send it first with the next thing it types to this agent within 10 minutes,
   if the box shows only that line. It is a try, not a promise: a line too long to show whole (item 5), or a
   next line held by a menu or a limit, is not pressed.
4. **The remembered line.** If the box still holds exactly the earlier line after the 300 ms watch (or tmux refused
   the Enter), it is remembered again with its original time and number.
6. **Dim across rows.** Measured on a scratch tmux server: capture-pane -e writes an escape only where the style
   changes, so a wrapped dim run's second row has none. visibleWithoutDim carries the dim state across rows, and the
   carry restarts at the box's own row, so a dim run left open higher up can never make typed text read as empty.
7. **The rule row** is tested on the raw row (escapes removed, dim kept), so a dim rule still ends the box.

## Closed with a reason
5. **Long lines are never pressed on.** This stays as decided: the capture cannot see the box rows Claude Code has
   scrolled out, so there is no way to see the whole box from tmux. Reopen only if Claude Code exposes its input.
8. **The 200-row capture.** Measured on a scratch tmux server with 3000 rows of scrollback, 60 captures each: visible
   only had a median of 3.8 ms (3.2 KB), -S -200 a median of 4.9 ms (19.6 KB). About 1 ms per look is not worth a
   change, so the deeper capture stays.
9. and 10. **The narrow races** are inherent: tmux has no atomic "read the box and press Enter". Stated, not fixed.
11. **The sync path.** About 15 server sweeps call the synchronous senders. The hold is up to 1.5 s only when a line
    stays in the box (rare), and one or two 60 ms looks normally. Moving every one to the async path is a broad
    change with its own risk for a rare, bounded cost.

## Evidence
- New tests: engine/chat.unsent-6256.test.js (9: items 1 to 4, with controls) and engine/status.composer-6256.test.js
  (4: items 6 and 7 and the restart at the box row, with controls). Mutants: each fix removed in turn (re-remember, noteUnsent, the hook call, the
  input branch, and the old status.js reader) turns its test red.
- Unchanged and passing, each run alone: chat.composer-6249 34, status.unsent-6249 7, chat.menuhold-5743 23, chat 148,
  messages 164, roomhold 27/2/12, limithold-5805 20, limitmsg-5805 40, limittask-5805 19, server.agyhold-4588 25,
  server.projects 178, web.unsent-input-6249 5, and the scanning guards.

## Weakest premise
Item 1's note is in memory only: a board restart while a box holds text leaves those posts for the next wake, as
before this card. Nothing reads the new unsent-submitted rows yet (item 2); they keep the log true for whoever reads it.

## Review 1 (opus), and what changed
- WARNING: a noted member was told every held project, and the note outlived its post: now only projects still
  holding a noted post id. WARNING: no limit or sign-out gate (#4797 churn): accountHeldVerdict added. WARNING: the
  sentence promised a send that a long line never gets: now "tries ... if the box still shows only that line".
  WARNING: the hold site and the real box read were untested: sendPost test and inputBoxEmpty cases added (mutants
  red). CONVENTION: flushReleased docblock and the server log suffix now name the input case. NIT: forget() drops the
  notes. Left: unsentSeq rides on chat's verdict (a local board API; harmless).
- Found while validating: engine.reachable flagged test-only exports (inputNoted, inputProjects, forgetInput); they
  are no longer exported, and the tests assert what the sweep tells instead.

## Review 2 (sonnet), and what changed
- WARNING: dim carried from row 0, so a dim run left open in the scrollback could make typed text read as empty (the
  dangerous direction). The carry now restarts at the box's own row; test with an open dim line above (mutant red).
- NIT taken: the comment says a minute that tells input-held posts skips the agy and #5805 paths for that member.
- NITs left: unsentPending is pruned on the next note (bounded by unsent messages in 15 min); unsentSeq rides on
  other senders' verdicts and is read only by messages.

## Review 3 (opus), and what changed
- No BLOCKER. WARNINGs stated, not fixed: (a) an earlier line whose Enter took but whose box emptied after the 300 ms
  watch gets no follow-up row: an empty box later cannot tell sent from cleared by hand (said in the chat.js comment);
  (b) when the box reads empty but the delivery is then refused (a person typing in that instant), the minute sweep
  logs a "could not yet be told" line each minute while it lasts, bounded by that condition. CONVENTIONs: test counts
  and item 6 updated. NITs taken: the sentence says the next line it types (any sender presses it); unsentPending is
  also pruned in the hook.

## Review 4 (sonnet), and what changed
- No BLOCKER. Two WARNINGs were already in this ledger (unsentPending pruned only on the next note or send, bounded;
  the late-emptied earlier line gets no follow-up row). DEFERRED, new: a told project's line includes plain posts held
  beside the input-held one. That is any wake's shape: the member is woken for that room, and a room's held posts go
  in one line. Splitting a room's line by why each post was held would tell the same room twice. NIT taken: a shorter
  sentence.

## Review 5 (opus): CONVERGED
- No BLOCKER, WARNING or CONVENTION. NITs taken: inputBoxEmpty reads paneTarget(card) (the exact pane the delivery
  types into); the re-remember comment says it is bounded (once per delivery, never past 10 minutes). Left: nothing
  reads the unsent-submitted rows yet (stated in Weakest premise).

## Rebased onto main after #6249 merged (PR #6279), 2026-10-15 21:4x
- Replayed this branch's 8 commits onto main (`git rebase --onto origin/main 0b5088a133`); #6249 had gained more
  commits before merging. Conflicts in engine/roomhold.js only: main had added `afterOf` (Renet's #4926 N7 diagnostic,
  #6271) to flushOnIdle and flushReleased and `carriedLine` to the exports. Kept both.
- Found by the tests, not the merge: the union of export lists re-added `inputNoted` after its function was gone, so
  the module threw ReferenceError on load. Fixed: the exports are exactly main's plus `noteInput` (checked by script).
- The input-held retry now passes `afterOf` to flushOnIdle like the other callers, so the N7 diagnostic also logs
  tellings this retry makes.
- Re-run on the rebased tree, each alone from the repo root: the 6256 and 6249 tests, chat, messages, the roomhold and
  4926 suites (n7diag included), limithold, server.agyhold and the scanning guards: all pass.

