# win-plistreaders-8466: the model a Windows card shows after a model change (kosmos#8466, first half)

**Posture:** production

## Problem
Follow-up to #8454 (PR #8467). engine/status.js withoutModelFromBeforeJob drops a Codex model reading taken from a
rollout written before the agent's job last changed, so after a model change the card does not name the old model. It
returned early on win32 ("a Scheduled Task has no file to compare"), so a Windows card named the OLD model until the
agent's first turn.

#8466's second item (create.js nameHeld on Windows) is NOT in this change: see the review log. It is #8471.

## Change
- status.js: on win32 the job's time is the file win32job.taskFilePath names (#8454), as the plist on macOS and the
  unit on Linux. The early return is gone. macOS and Linux are unchanged.
- engine/status.codex-model-switch-4416.test.js runs on Windows (its skip is gone; it also checks the stand-in task
  file is the file the board reads) and moves from HOST_BRANCH_EXCLUDED to ALSO in tools/windows-tests.js.

## Decided, not missed
- On Windows a stop and a start (/Change /DISABLE, /ENABLE) rewrite the task file too (measured for #8454), so they also
  drop the reading until the next turn, and the card shows the job's planned model, the one the next launch runs.
- The weakest part: that planned model is wrong while a session runs another one: a saved model change whose restart
  failed (macOS has the same case), or a world switch that disabled and re-enabled a task it could not stop. Both are
  failure paths. Documented in the code comment.
- A stat per Codex pane whose rollout names a model, as on macOS: about 6 microseconds, no schtasks call.

## Measured on the Windows box
status.codex-model-switch-4416 0/0/2 skipped on main -> 2/0/0; negative control: with origin's status.js the first test
fails. status.test 227/0/17 unchanged. Run the way CI runs it (no preload, stdin closed, an 8.3 TEMP): 2/0/0. Policy
tests pass.

## Review log
- Round 1: BLOCKER on the second half. A folderless Kosmos task is invisible on a Windows board (win32roster lists live
  sessions only; createdroster is not wired on win32 and skips a job with no folder; settingsLeftovers needs
  job === false; register.survey needs a folder), and Kosmos makes that state itself (a delete whose task removal fails
  still recycles the folder on Windows). With nameHeld fixed, create would refuse such a name forever and point at a page
  that does not list it. DECIDED: split; nameHeld and its test reverted to main, so create on Windows keeps overwriting
  such a task with /Create /F as today. Filed #8471 (list a folderless task on win32, stop recycling the folder when the
  task could not be removed, then nameHeld). Rejected: making create remove the task first and proceed (it changes what
  create does to an existing task and wants its own review).
- Round 2 (no blocker, 2 warnings). The comment and this plan said the change could only drop a reading, "never a wrong
  one"; false on the failure paths above. FIXED: both say when the planned model is wrong. This plan described the
  reverted half; rewritten to match the diff.
