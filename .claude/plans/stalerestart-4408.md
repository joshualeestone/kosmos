# stalerestart-4408: a board running stale code restarts with one button; an update never leaves one (kosmos#4408)

Ben on prod (Josh, #admin 15:01): "Kosmos changed on disk ... Only a restart picks it up: kosmos restart", and reopening
the app did not clear it (the window restart does not restart the board process).

## Why the update left his board stale (read from code)
- install/setup.sh pauses the board (`kosmos stop`, which writes the stop marker), swaps the files, then runs
  `kosmos start`.
- `kosmos start` (install/kosmos cmd_start) clears the stop marker and, if ANY healthy board answers, says
  "already running" and returns.
- So a board started again BEFORE the swap boots the OLD code and survives the final start. One source is the app
  window's reload running `kosmos start` during the pause (#4347's trace); any other start in that gap does the same.
- The board then reports staleSince (loaded modules newer than its start), which is the toast Ben saw.

## What changes
1. install/setup.sh: on an UPDATE the start step runs `kosmos restart` (stop then start), so the board that answers
   is the one on the new files. A fresh install still runs `kosmos start`. In a marked block,
   start_board_after_install, run by tools/test-start-after-install-4408.sh against a fake CLI that reproduces the
   bug (control arm), wired into test:shell. Red on the old `start`.
2. server.js: `engine` gains `canRestart` (asked only while stale), and POST /api/engine/restart restarts through
   engine/boardrestart (the world-switch path: a detached `kosmos restart`, or the launchd/logon job). Refused (409,
   with why) when the board is current or cannot bring itself back. Tested in server.engine-restart-4408.test.js
   with boardrestart stubbed (no launchd, fake CLI, recording spawner), including a CONTROL.
3. web/index.html: the toast reads "Kosmos needs a quick restart", "To finish updating. Your agents keep running."
   with one Restart Kosmos button when canRestart; otherwise "To finish updating, restart your computer." (Windows
   keeps its own copy). No Terminal wording (#996). The button POSTs, shows Restarting, keeps the did-not-answer
   screen down while the board bounces, and reloads when a board with a new start time answers (2 minutes, then says
   so and offers the button again). Browser check render-engine-restart-4408.

## Rejected
- Restarting the board automatically: a board restart interrupts every open page and any in-flight request; one
  button is what the card allows and keeps the person in charge of when.
- Stopping the window's reload from running `kosmos start` mid-update: the restart in (1) makes any early start
  harmless, whoever caused it.

## Weakest premises
- The cause is inferred from code; Ben's own log was not read. The fix in (1) does not depend on which process
  started the board early.
- canSelfRestart says yes on an installed Mac (the kosmos CLI arm); a board where it says no gets the plain-words
  fallback, not a button.
