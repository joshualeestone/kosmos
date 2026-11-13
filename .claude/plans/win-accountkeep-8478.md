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
- Agents written before this change: the task-only delete (delete-leftover.del) reads the account folder and model from
  the task itself and records them (create.recordWin32TaskFromTask) just before removing it, when the profile has no
  record. Never a gate: a read or write that fails leaves the delete as it was.
- Round 1: removing or disconnecting a Claude or OpenAI account (accounts.js / openaiaccounts.js forgetAccount and
  removeAccount, wrapped at the export through create.afterAccountGone) clears that folder from every record naming it
  (model kept, marked accountRemoved), because the removal check finds agents through their tasks only and the next
  sign-in reuses the folder name. Never refuses the removal. A recorded folder Kosmos cannot reach is said as "cannot
  reach right now" (a disk or share may be unplugged), and repair keeps it in the record (the task runs on main
  meanwhile) so the agent comes back on it once it can be reached.
- Tests: engine/delete-leftover.win32-accountkeep-8478.test.js (10).

## Decided, not missed
- Windows only: on macOS and Linux the plist or unit is the source of truth and nothing in Kosmos removes it alone.
- The weakest part: the Start at login report itself does not say when an account folder was gone (the delete and
  Restore words warn first). And the task-only PLAN's words for an agent with no record are read from the task (what
  the delete is about to record), so if that record's read or write then fails, the plan promised the account and model
  and the outcome, read after, says the main account and the model it last ran (true, but different from the plan).
  A task removed some other way (by hand in Task Scheduler) still loses an unrecorded agent's account and model.
  Round 1 residuals: the clearing reaches this Kosmos's profiles only (another world on this computer keeps its
  records); Gemini and Grok account removals do not clear (same risk class, not in the decision); an account folder
  deleted by hand outside Kosmos, kept in a record as "cannot reach", could be reused by a later sign-in.
