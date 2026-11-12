# win-plistreaders-8466: two more Windows readers of a job through a plist path (kosmos#8466)

**Posture:** production

## Problem
Follow-up to #8454 (PR #8467): two more places read a Windows agent's job through a plist path, which never exists on
Windows, where the job is a Scheduled Task.
1. engine/status.js withoutModelFromBeforeJob returned early on win32 ("a Scheduled Task has no file to compare"). So
   after a model change, a Windows card named the OLD model (read from the rollout) until the agent's first turn.
2. engine/create.js nameHeld stat'ed the plist path on win32, so its "job" was always false: a leftover Kosmos task with
   no folder did not hold its name for create or teamseed.

## Change
- status.js: on win32 the job's time is win32job.taskFilePath's file (#8454), as the plist on macOS and the unit on
  Linux. The early return is gone.
- (Moved to #8471 after review 1, see the log below.) create.js nameHeld: on win32 the job is that file existing (a stat, not a schtasks query, because teamseed asks per
  seat; a non-elevated board can stat it, measured).
- Tests: engine/status.codex-model-switch-4416 runs on Windows (its skip is gone; it checks the stand-in task file is
  the file the board reads) and moves from HOST_BRANCH_EXCLUDED to ALSO in tools/windows-tests.js. engine/create.test.js's
  leftover-job refusal test writes the job through jobfixture (a task file on Windows, not a plist) and checks nameHeld
  both ways. Negative controls: each new Windows check fails with its source file restored from origin/main.

## Decided, not missed
- A stop or a start rewrites the task file on Windows (/Change, measured for #8454), so it also drops the model reading
  until the next turn; the card then shows the job's planned model, the one the next launch runs. A missing reading,
  never a wrong one: every model change goes through /Create /F, which moves the file.
- The weakest part, OPEN for review: with nameHeld fixed, create on Windows REFUSES a name held by a leftover task with
  no folder (as macOS does) where before it silently overwrote it with /Create /F. Its sentence sends the person to the
  Agents page to delete what was left. If the Windows board does not list a folderless Kosmos task there, the person
  has no way out from the screen; then the Windows arm must not refuse (keep the old overwrite) or the listing must
  exist first.

## Measured on the Windows box
status.codex-model-switch-4416 0/0/2 skip -> 2/0/0; create.test 130/0/111 unchanged in count with the refusal test now
on a task file; every other file that touches these functions unchanged (status.test, teamseed, modelname-4416,
create.win32-job-read 40/0, create.win32-switchedoff-8417 19/0, win32job.taskfile-8454 3/0, server.codexlimits-6176
8/0). Policy tests pass.

## Review log
- Round 1: BLOCKER confirmed on the open risk above. A folderless Kosmos task is invisible on a Windows board (win32roster
  lists live sessions only; createdroster is not wired on win32 and skips a job with no folder; settingsLeftovers needs
  job === false; register.survey needs a folder), and Kosmos makes that state itself (a delete whose task removal fails
  still recycles the folder on Windows). With nameHeld fixed, create would refuse such a name forever and point at a page
  that does not list it. DECIDED: split. This change ships only the status.js half (the model after a change), which
  can only drop a reading, never show a wrong one (re-verified by the reviewer). The create.js nameHeld half and its
  create.test.js change are reverted to main, so create on Windows keeps overwriting such a task with /Create /F as
  today. Filed #8471: list a folderless task in the removed list on win32, stop recycling the folder when the task could
  not be removed, then land nameHeld. Rejected: making create remove the task first and proceed (it changes what create
  does to an existing task, and wants its own review). What would change my mind: evidence the overwrite itself harms.
