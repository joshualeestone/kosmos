# unsent-6436: a line the board left in an agent's input box never blocks it for good

Card: kosmos#6436 (feedback, 2026-10-17). Decision comment: issuecomment-6242027748.

## Measured
Claude Code 2.1.302, a 1,500-byte single line pasted the way delivery pastes it (256-byte chunks, no Enter):
- 160 columns: the box reader sees it all; composerIsAll true.
- 80x24: the box scrolls; the reader sees its last 462 characters, with the ❯ drawn on the first VISIBLE row, so
  composerIsAll is false and the remembered line was never pressed. Every agent pane here is 80x24 (tmux default-size).

## Change (engine/chat.js)
- `rememberedShows(text, kept)`: all of the line (as before), or exactly what the box showed when the line was left
  (`seen`, recorded on the unsent verdict) when that is the line's end. A person who cut or added to the visible part
  changes it: never pressed.
- No 10-minute expiry (UNSENT_REMEMBER_MS removed): kept until sent, emptied, or replaced.
- The memory is on disk (`unsent-lines.json` in the state folder, mode 600), so a restart keeps it. A loaded line has
  no message number, so its follow-up row is not written.
- `scheduleUnsentRetries`: after an unsent verdict, `pressRememberedNow` at 30 s, 2 min and 5 min, under the same
  rules as the press a delivery makes first, and never while a delivery is typing to that pane.
- engine/messages.js: the follow-up row waits a day (was 15 minutes, sized to the old 10).

## Not changed
Text that is not the board's own is never pressed and never cleared. Dim suggestion text is an empty box.

## Known gap
After a restart, the loaded line is pressed by the next delivery to that agent, not by a retry (retries are scheduled
from a delivery, which carries the card the pane check needs).

## Status
- [x] Code; engine/chat.unsent-6436.test.js (scrolled, cut/added control, restart and file mode, retries, retry
  controls, ghost); two older tests updated (expiry reversed, sentence). Three mutants caught.
- [x] chat, messages, roomhold, status composer tests and engine.reachable: 729 + reachable 8 green
- [ ] Challenge loop, validation, proof, PR, merge
