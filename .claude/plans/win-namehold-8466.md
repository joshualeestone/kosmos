# win-namehold-8466: a Windows leftover task holds its name (kosmos#8466, second half)

**Posture:** production

## Problem
engine/create.js nameHeld stat'ed create.plistPath on win32, which never exists there (a Windows job is a Scheduled
Task), so its "job" was always false: a leftover Kosmos task with no folder did not hold its name, and create and the
team step silently overwrote it with /Create /F. This waited on #8476 and #8482 (#8475), because refusing a name needs a
true way to free it from the screen: since #8482 the list at the bottom of the Agents tab shows such a task with
"Remove its startup job...", whose delete removes only the task.

## Change
- nameHeld on win32: the job is the file win32job.taskFilePath(name) names existing (as #8454 and #8466's first half
  did). macOS and Linux unchanged.
- create's refusal for a held name on Windows (win32HeldTaskWords): true words for each case, each with a way out that
  exists:
  - the task's row is listed: press the toggle ("Show what is left of past agents", or "Show removed agents and what
    is left of others" when the removed list has agents; both named if it cannot be read), then "Remove its startup
    job..." (the screen's ellipsis character) beside the name the row draws (its shownAs, not the typed spelling);
  - no row (no settings behind the task, workers folder missing, waiting to start, a failed look): delete agent-<name>
    in the Kosmos folder of the Task Scheduler Library;
  - a link that leads nowhere at the folder path: connect the disk, or delete the link and then the task;
  - a running agent: stop it from its card first (deleting its task would not stop it).
- Team step (teamseed.js): a seat held only by a leftover Windows task gets create's words, after "the <seat>'s name:";
  every taken seat is still said in one answer (the agents' sentence first).
- Setup guide (setup-assistant.js seedSetupAssistant), ONE narrow Windows rule on main's version. Main moves on to the
  second name ("Josh AI") only on create's "already an agent called". On win32, after a refused first name:
  - anything at the folder path (a folder, a link, even one that leads nowhere): STOP, whatever the sentence. Main read a Windows guide as "already a folder" and stopped;
    with the task now read, a healthy guide whose seeded flag is missing reads "already an agent called", and main's
    rule would make a second guide beside it;
  - a leftover task with no folder (which now holds the name, where main overwrote it): move on, unless the name is on
    the removed list (main stops there, and still does);
  - anything else, and a look that fails: main's rule. macOS and Linux: main's rule exactly. A tests-only `platform`
    option lets a Windows host pin that.
- Tests: new engine/create.win32-namehold-8466.test.js (14); create.test.js's leftover-job test writes the job through
  jobfixture (it passed on Windows only by reading a plist).

## Decided, not missed
- Why the guide part is narrow: rounds 1 to 4 widened it (move on for any name refusal, then adopt a guide by its marker,
  then by its birth record, then names-taken only for real agents), and each round found a new problem (a second guide
  beside a healthy one, a false "two of your agents" sentence, the seeded flag written for a guide with no job, a macOS
  change with no macOS test). None of that is #8466. The narrow rule changes only what #8466 itself changed on Windows.
  Adopting an existing guide when its flag is missing, and names-taken for leftovers, are carded as #8484.
- Refusing a held name is safe in every case found, and every refusal names a way out that exists. A removed name is
  refused by the removed list before nameHeld, unchanged. The one older dead end (a removed agent whose recorded folder
  outside the workers folder is gone from a connected disk) is #8475's named weakest part, not new here.
- Weakest parts: a healthy Windows agent with a folder and a task now gets the "half made" sentence that macOS gives,
  where main said "already a folder"; both point at the agent page, not checked on a Windows board. A Windows guide whose
  seeded flag is missing is neither adopted nor duplicated: nothing is made and the automatic path retries on backoff,
  as main did on Windows.

## Review log
- Round 1: setup guide stuck on a leftover task (widened, later narrowed); team-step words; comment; exact screen words.
- Round 2: the widened rule made a second guide beside a healthy one (adoption added, since removed).
- Round 3: a guide with no marker duplicated; names-taken shown for leftovers; team step one answer (kept).
- Round 4: further guide problems; DECISION: narrow to the one Windows rule above. Nit: the row's own shownAs (kept).
- Round 5: the folder test was existsSync, so a guide folder behind a link that leads nowhere (a disk not connected)
  read as no folder and "Josh AI" was made beside it; now lstat, as settingsLeftovers and win32HeldTaskWords look
  (test 13). Nit: the team step reads the leftover list once per answer, not once per held seat (test 14).

## Measured on the Windows box
New file 14/14. Negative controls, one file at a time:
- 72041a54ff's setup-assistant.js fails 13; its teamseed.js or create.js fails 14.
- origin/main's setup-assistant.js: fails 9 (leftover task moves on), 10 (no second guide beside a healthy one) and 12
  (only its win32 CONTROL arm, since main has no platform option; the macOS and Linux pins pass on main).
- the win32 folder-stop removed: fails 10 and 12. The removed-list check removed: fails 11.
- 10350778be's create.js: fails 4 (the row's own shownAs).
- origin/main's create.js: fails 2 to 9 (test 1 pins macOS and Linux, unchanged, by design; 10 to 12 do not depend on
  the task being read).
