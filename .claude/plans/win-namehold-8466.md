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
- Review 1 (no blocker; 1 warning, 3 nits), all fixed:
  - WARNING: the setup guide (setup-assistant.js seedSetupAssistant) moved on to its second name only when create's
    refusal said "already an agent called", so a leftover task under the guide's first name ("something called Josh is
    still set to start ...") meant no guide, silently, on every try. It now moves on for any refusal create marks as
    about the name (field 'name', #2606; the old sentence still counts for a caller with no field), except a name on
    the removed list: the person took that guide off the board, and a second guide would undo that (as before, nothing
    is made then). This also helps macOS and Linux, where a leftover job or folder, or a name already running, under
    the guide's first name had the same silent gap. A healthy Windows guide keeps working (the "already an agent" case).
  - Nit: the team step gives a seat held only by a leftover Windows task create's own words (create.win32HeldTaskWords,
    after "the <seat>'s name:"), not "there is already an agent ... already on your board".
  - Nit: the comment above win32HeldTaskWords reworded (each sentence ends with its own full stop) and wrapped.
  - Nit: the sentence quotes the screen exactly: the toggle "Show what is left of past agents", or "Show removed agents
    and what is left of others" when the removed list has agents (both if it cannot be read), and the button
    "Remove its startup job..." with the screen's ellipsis character.
- Tests: new engine/create.win32-namehold-8466.test.js (8 since review 1); create.test.js's leftover-job test writes the job through
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
After review 1: 8/8. Against ca23722255's source, one file at a time: setup-assistant.js fails test 8; teamseed.js fails
test 7; create.js fails 3, 4 and 7. Test 8's removed-list control fails with that exception taken out.
