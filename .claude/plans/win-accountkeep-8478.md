# win-accountkeep-8478: a Windows agent comes back on the account and model it was set to (kosmos#8478)

**Posture:** production

## Problem
On Windows a Claude or Codex agent's account folder and chosen model were recorded only in its Scheduled Task, so
removing the task (#8475's task-only leftover delete) lost them, and Start at login brought it back on the main account
and the last model it ran.

## Change (Windows only)
- create.js records profile.win32Task = { runner, configDir, model } whenever the task is written (sync rewrite, async
  put-back, installJob's Windows arm, creation); win32RecordedTask reads it and says whether the folder and model are
  still usable (statSync: a dead junction is unusable).
- register.js repair uses the recorded folder and model where usable, falling back per item.
- delete-leftover.js startsAgainWords and remove.js's Restore say which comes back, with the same reader as repair.
- Tests: engine/delete-leftover.win32-accountkeep-8478.test.js (7).

## Decided, not missed
- Windows only: on macOS and Linux the plist or unit is the source of truth and nothing in Kosmos removes it alone.
- The weakest part: the Start at login report itself does not say when an account folder was gone (the delete and
  Restore words warn first).
