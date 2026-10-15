# unsentfollow-6256: follow-ups from the #6249 review rounds (an unsent line in an idle agent's input box)

Stacked on msgsubmit-6249 (0b5088a133, Sonya's #6249, not merged yet); rebased onto main when it merges. Splinter
routed it 2026-10-15 17:05. Finished looks like: each of the card's 11 items fixed or closed with a reason.

## Fixed
1. **Room posts held by text in the box.** messages.js notes the member (roomhold.noteInput) when a post is held
   with heldBy 'input'. roomhold.flushReleased (the once-a-minute sweep) then tells every held project of a noted member
   once chat.inputBoxEmpty(card) reads the box empty, the member is not in a fresh working turn, and it is addressable.
   The note goes once nothing is held. Kept in memory: after a restart these wait for the next wake, as before.
   Rejected: flushing when the card's unsentInput clears (it only shows after 3 minutes, so a box cleared sooner never
   set it).
2. **The record.** Each remembered line has a number (unsentSeq on its verdict). messages.js keeps message rows marked
   unsubmitted by that number. When a later delivery presses Enter on the line and the box empties, chat calls a hook,
   and messages appends `{ kind: 'unsent-submitted', of: <id>, from, to, at }`. The reader accepts the new kind, as it
   does held-delivered. A line some other sender left (a nudge, a room post) has no message row and writes nothing.
   `earlierSubmitted` stays on the verdict (tests read it).
3. **The sentence** now says the next message Kosmos types to this agent within 10 minutes sends it first, if nothing
   else has been typed into the box.
4. **The remembered line.** If the box still holds exactly the earlier line after the 300 ms watch (or tmux refused
   the Enter), it is remembered again with its original time and number.
6. **Dim across rows.** Measured on a scratch tmux server: capture-pane -e writes an escape only where the style
   changes, so a wrapped dim run's second row has none. visibleWithoutDim carries the dim state across rows.
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
- New tests: engine/chat.unsent-6256.test.js (6: items 1 to 4, with controls) and engine/status.composer-6256.test.js
  (3: items 6 and 7, with controls). Mutants: each fix removed in turn (re-remember, noteUnsent, the hook call, the
  input branch, and the old status.js reader) turns its test red.
- Unchanged and passing, each run alone: chat.composer-6249 34, status.unsent-6249 7, chat.menuhold-5743 23, chat 148,
  messages 164, roomhold 27/2/12, limithold-5805 20, limitmsg-5805 40, limittask-5805 19, server.agyhold-4588 25,
  server.projects 178, web.unsent-input-6249 5, and the scanning guards.

## Weakest premise
Item 1 tells every held project of a noted member once its box empties, including plain posts held for its next wake.
That is a wake the member would have had anyway (the input-held post was meant to go now).
