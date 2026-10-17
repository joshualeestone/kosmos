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
- [x] Round 1 (opus): a resized pane (a person attaching) re-wraps the visible end, so any end of the line 200
  characters or longer also counts (SCROLLED_MIN), with the seen match kept for shorter ends; retries are async (they
  no longer hold the board, #4468); the file keeps at most 100 lines; stale comments fixed; retry arms tested
  (still unsent, a newer line). Mutants: the 200 path, the newer-line guard.
- [x] Round 2 (sonnet): a retry holds the pane busy (deliveryQueues) while it watches and forgets only its own line;
  lines carry ids (the newer-line guard compared milliseconds); unattended retries take only the exact match (all, or
  `seen`), leaving the 200-character end to deliveries; lines older than 7 days are not loaded. Declined: "after an
  Enter, other means it was sent": other means our end is still there with text added, so it was not. Measured: the
  busy guard is redundant with the box read (a mutant removing it survives: a delivery in flight leaves the box empty
  or holding its own line, and presses the earlier line itself), kept as a second guard; the id guard is tested.
- [ ] Challenge loop convergence, validation, proof, PR, merge

## Stated limit (round 1)
The rows above a scrolled box's visible end cannot be seen. A person who typed there (cursor moved to the start and
back) would be sent with it. Text added after ours, or other text on screen, is never pressed. A long end cut shorter
on screen is all ours, so it is pressed: the words sent are the board's own.
