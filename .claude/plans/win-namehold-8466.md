# win-namehold-8466: a Windows leftover task holds its name (kosmos#8466, second half)

**Posture:** production

## Problem
engine/create.js nameHeld stat'ed create.plistPath on win32, which never exists there (a Windows job is a Scheduled
Task), so its "job" was always false: a leftover Kosmos task with no folder did not hold its name, and create and the
team step silently overwrote it with /Create /F. This waited on #8476 and #8482 (#8475), because refusing a name needs a
true way to free it from the screen: since #8482 the removed agents list shows such a task with "Remove its startup
job", whose delete removes only the task.

## Change
- nameHeld on win32: the job is the file win32job.taskFilePath(name) names existing (as #8454 and #8466's first half
  did). macOS and Linux unchanged.
- create's refusal for a held name on Windows (win32HeldTaskWords): true words for each case, each with a way out that
  exists: the listed row and its button; Task Scheduler (delete agent-<name> in the Kosmos folder of the Task Scheduler
  Library) where no row is listed (no settings, workers folder missing, waiting to start, a failed look); a link that
  leads nowhere at the folder path (connect the disk, or delete the link and then the task); a running agent (stop it
  from its card first, since deleting its task would not stop it).
- Tests: new engine/create.win32-namehold-8466.test.js (7); create.test.js's leftover-job test writes the job through
  jobfixture (it passed on Windows only by reading a plist).

## Decided, not missed
- Refusing is safe in every case found, and every refusal names a way out that exists. A removed name is refused by the
  removed list before nameHeld, unchanged. The one older dead end (a removed agent whose recorded folder outside the
  workers folder is gone from a connected disk) is #8475's named weakest part, not new here.
- The weakest part: a healthy Windows agent with both a folder and a task now gets the "half made" sentence that macOS
  gives, where main said "already a folder"; both point at the agent page, which was not checked on a Windows board.

## Measured on the Windows box
New file 7 tests: 6 fail on main's create.js (test 1 pins macOS and Linux, unchanged, by design). create.test.js 130/1
on main's source, 131/0 here (111 skipped either way). teamseed 29, the delete-leftover files and the policy tests
unchanged and passing.
