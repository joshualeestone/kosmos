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
    the guide's first name had the same silent gap. (Corrected in review 2: as written in round 1 this made a SECOND
    guide whenever the guide itself held the name and its seeded flag was missing; see below.)
- Review 2 (no blocker; 1 warning, 1 nit), both fixed:
  - WARNING (reproduced by the reviewer): a guide "Josh" already here (folder, marker, task) whose seeded flag is
    missing (a failed write, or the board died between the create and the write) was refused as "already an agent
    called", and the seed then made "Josh AI" beside it. On macOS main did the same (that sentence was the one it
    moved on for); on Windows main stopped. Now a name whose folder carries the guide's marker (isGuideFolder) is
    ADOPTED: returned as seeded, ensureGuide writes the flag, nothing is made. Also when its folder has no startup job:
    it is still the guide, and a second guide would not mend its job (its page and the restart notice deal with that).
    Only a name held by something that is not the guide (a leftover task, another agent) moves on. (Round 2's weakest
    part, a guide whose marker was never written, was reproduced in review 3 and is fixed there.)
- Review 3 (no blocker; 2 warnings, 1 nit), all fixed:
  - WARNING 1 (reproduced): a guide with no marker (deleted, or never written) got a second guide. The birth record
    exists: create.createdLog (created.jsonl, written before createAgent returns) and create.isAutoGuideBirth (now
    exported). guideBirthFor: while the name's folder is there, the NEWEST line that made an agent under that slug
    decides; a guide's CREATED line is adopted (and its marker written again), a guide's PARTIAL line stops the seed
    (nothing made, nothing adopted that does not work), anything else is not the guide. Newest, not any: a guide
    deleted and its name then used by the person's own agent is that agent's (tested). No folder: not adopted, since
    what holds the name then is a leftover task (adopting would write the flag for a guide that cannot run).
  - WARNING 2: names-taken (final for the process; the screen then says two of the person's agents use the names, and
    the beacon that the install has agents) only when BOTH names are held by a real agent: create's "already an agent
    called", or a folder there, as main's rule was. A leftover task or job alone keeps main's retry on backoff.
    ensureGuide reads only the seed's answer now (the last reason alone would count a leftover task under the first
    name as an agent).
  - Nit: the team step keeps every taken seat in one answer: the agents' sentence first, then each seat a leftover
    task holds, in create's words.
- Weakest part now: a guide made before the birth log carried createdBy, role and purpose (#1279), with its marker
  also gone, is not recognised and the second name is tried. Also, the birth log is read whole on each name refusal
  (once per seed attempt). Would change my mind: a guide id kept in its profile.
  - Nit: ensureGuide stops for the process (names-taken) on the seed's own answer that both names are held by
    something other than the guide (namesTaken), not only on the "already an agent called" sentence.
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
After review 3: 11/11; against 87bf2e07b9's source, one file at a time: setup-assistant.js fails 10 and 11, teamseed.js
fails 7, create.js fails 11 (isAutoGuideBirth was not exported).
After review 2: 10/10; against e56dd9f28c's setup-assistant.js, tests 9 and 10 fail.
After review 1: 8/8. Against ca23722255's source, one file at a time: setup-assistant.js fails test 8; teamseed.js fails
test 7; create.js fails 3, 4 and 7. Test 8's removed-list control fails with that exception taken out.
