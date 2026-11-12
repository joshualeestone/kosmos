# win-leftover-8471: a Windows leftover task with no folder can be seen and deleted (kosmos#8471, first two parts)

**Posture:** production

## Problem
On Windows a leftover Kosmos Scheduled Task with no agent folder showed nowhere on the board (the roster lists live
sessions only; the removed list needed job === false; the restart notice needs a folder), so nobody could delete it
from the screen. Kosmos made that state itself: a delete whose win32job.remove failed still sent the folder to the
Recycle Bin, kept the settings and forgot the removal (the review-33 keep-the-folder guard covered Linux units only).
This also blocks #8466's second half (create.js nameHeld on win32), which would refuse such a name.

## Change
- engine/delete-leftover.js: the keep-the-folder guard covers a Windows task too. When Task Scheduler will not remove
  the task, the delete stops whole (folder, settings, removal record, tokens kept), so the agent stays visible and the
  delete can be retried; the sentence is the Linux one in Windows words.
- engine/delete-leftover.js settingsLeftovers: on win32 it also lists a name with a profile, no folder and a task still
  registered (job === true; a failed look, null, lists nothing), not removed and not running, marked startsAtLogin.
  Its delete (plan and del) already handles a task with no folder: tested end to end.
- Both the list and plan() treat the workers folder as a fleet-wide signal: while it is missing, a link that leads
  nowhere, or holds no agent folder at all (renamed or moved, then remade empty), no task is listed and a task-only
  delete refuses, naming the task to delete in Task Scheduler if the folder is gone for good (reviews 4 to 8).
- server.js /api/removed passes startsAtLogin; web/index.html's row says "Its settings and its startup job are left"
  for it (not "Only its settings are left", which would be false); docs/browser-checks/render-settings-leftover-7825.js
  checks that row. Both browser-check gates pass locally.
- Tests: new engine/delete-leftover.win32-leftover-task-8471.test.js (7), selected for Windows CI by its name; the
  7820 test now pins the refusal sentence (it pinned the partial-delete one).
macOS and Linux are unchanged.

## Decided, not missed
- Not in this change: create.js nameHeld on win32 (#8466's second half). It lands after this, now that the leftover
  can be seen and deleted.
- macOS: filed as #8474 and closed as not planned by its builder (the Mac board already shows a stopped agent with a plist and no folder, with its Delete), so this change is Windows only.
- The weakest part: one agent whose own folder was renamed by hand (the workers folder still holding others) reads as a task left with no folder and is offered (typing the name is required); and a person whose LAST agent folder is truly lost gets only the Task Scheduler way out. Also startsAtLogin is set for a switched-off task too (the row's words stay true).

## Measured on the Windows box
New file 7/7; negative controls: with origin's delete-leftover.js every test but 3 (the control) fails (part 1 alone: 1
and 2; part 2 alone: 4; review 4 alone: 5; review 5 alone: 6). The 46 files that load delete-leftover or remove: 1437/116/25
before, 1442/116/25 after (the 116 are the same failures on this box both ways). Policy tests pass.

## Review log
- Round 1 (no blocker, 2 warnings, 1 convention, 1 nit). (1) The new row's delete told the person "its settings cannot
  go to the Recycle Bin, so they are deleted for good", a false reason. I first let the settings' own Recycle Bin answer
  decide; that broke #7820's pinned test, whose reason is that with no folder the outcome sentence ("Nothing starts X
  any more") must never stand over a record promised the Recycle Bin. DECIDED: keep #7820's design (a task-only delete
  removes the settings for good and asks for the name) and fix the sentence to the fact: "Its startup job is removed,
  and its settings are deleted for good." Rejected: settings to the Recycle Bin here (needs new outcome sentences for a
  move that fails partway; its own change). Would change my mind: someone needing a task-only leftover's settings back.
  A Linux unit-only leftover says the same false reason; left as it is (a Linux test pins it). (2) "Try again in a
  moment" can be false (another account's task answers "Access is denied" every time): the sentence now names the task
  to delete in Task Scheduler if it keeps failing. (3) server.js's comment on /api/removed now names the Windows task
  and startsAtLogin. Not changed (nit): verbFor's 'its startup job' arm is now only a fallback.
- Round 2 (no blocker, 3 warnings, 3 nits). Fixed: (1) the button now says "Remove its startup job and delete its
  settings" for a Windows task with no folder, as the sentence above it does (Linux unchanged). (2) A server test now
  checks /api/removed keeps startsAtLogin for a Windows task left with no folder (negative control: with the field
  dropped from the route's mapping, it fails). Nits fixed: one "and" per sentence; the web comment says the task is
  still registered (a removed agent's leftover task is disabled, so "still starts" was not always true); the refusal
  names the task as Task Scheduler shows it (the agent-<name> task in its Kosmos folder). Not changed: (3) the #7820
  test now pins the refusal sentence rather than verbFor's "remove its startup job" arm, which is a fallback now.
- Round 3 (no blocker or warning; 1 convention, 4 nits). Fixed: the plan's weakest part (it still said no server test
  covers startsAtLogin, which round 2 added) now names the real one; the task-only sentence is two sentences when a
  picture is stored too ("Its startup job is removed. Its settings and picture are deleted for good."); the refusal
  says "the Kosmos folder of the Task Scheduler Library", not "its Kosmos folder" (which read as the agent's). Not
  changed: the pending-name and damaged-settings checks for a task with no folder (a narrow race, named above as the
  weakest part); the field name startsAtLogin (internal).
- Round 4 (no blocker; 1 warning, 1 convention, 2 nits). (1) FIXED the warning: plan() skipped strandedRefusal for a
  task with no folder, so with the workers folder behind a junction to an unplugged disk, every agent would read as a
  task left with no folder, and a delete would remove its task and its settings for good. plan() now runs strandedRefusal
  for it (a name waiting to start, a recorded folder behind a dead link, a damaged settings file) and refuses while the
  workers folder itself leads nowhere. New test with a real dangling junction; negative control: without the check it
  fails. This also closes round 3's race. (2) The settingsLeftovers header now says Windows also lists a registered
  task. Nits: the plan's 7820 line fixed; the pre-existing hint and done sentences, now reachable, stay true.
- Round 5 (no blocker; 1 warning, 1 convention, 1 nit). (1) FIXED the warning: a workers folder that is not there at
  all (its drive not connected, or renamed or moved) still made every agent with a task deletable, its settings lost
  for good (the reviewer reproduced it); resolveRecordedFolder reads a missing drive as "the rest is gone". plan() now
  refuses a task-only delete while the workers folder is not a folder, and names the task to delete in Task Scheduler
  if that folder is gone for good (the way out). New test; negative control: without the check it fails. (2) Comments
  no longer say "the same checks as settings alone": the task-only checks are stricter (settings alone go to the
  Recycle Bin, which can be undone). (3) The Measured numbers updated (7 tests).
- Round 6 (no blocker; 1 warning, 3 nits). The reviewer tried every way a healthy agent's folder can read as missing
  (dead junction or missing workers folder, a dead junction for the agent's own folder, a recorded folder on an
  unconnected drive, an ACL-unreadable folder, a running agent, mid-move, mid-create, a world switch): plan() refuses
  each. (1) FIXED the warning: the list itself still showed every stopped agent as "settings and startup job left"
  while the workers folder was missing or a dead link; settingsLeftovers now lists a task only while the workers folder
  is there as a folder (one stat per call). Negative control: without it, both workers-folder tests fail on the list
  check. Nits fixed: both workers-folder refusals end with the same way out ("delete agent-X in the Kosmos folder of the
  Task Scheduler Library, then try again here"); the plan's weakest part updated.
- Round 7 (no blocker; 1 warning, 1 nit). No way found for a delete to reach a live or recoverable agent, and no real
  leftover trapped without a true way out. (1) FIXED: three tests passed only by order (no test made the workers folder
  until an earlier one did); the sandbox now makes it at the start, and each passes alone. (2) The "could not check"
  refusal names the folder Kosmos keeps its agents in, which is the look that failed.
- Round 8 (the fleet cap; no blocker rated, 1 warning, 2 nits). The warning: a workers folder renamed or moved and
  remade empty by the next create made every stopped agent with a task deletable, its settings lost for good once the
  name was typed, though all could come back by renaming the folder back. I treated it as a BLOCKER, which is what lets
  the loop pass the 8-round cap: main cannot do this (those tasks are invisible there), so this change would ship a
  NEW way to lose data. FIXED: workersFolderState() ('missing', 'empty', 'ok'), shared by the list and plan(); an empty
  workers folder lists nothing and refuses with the way out. New test; negative control: without it, it fails; every
  test passes alone and in order, with and without the preload. server.test.js's removed-list test makes a neighbour
  agent folder (361/0/8 whole). Nits fixed: the could-not-check sentence; the Change section now states the
  workers-folder conditions. Round 9 follows.
