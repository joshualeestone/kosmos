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
- server.js /api/removed passes startsAtLogin; web/index.html's row says "Its settings and its startup job are left"
  for it (not "Only its settings are left", which would be false); docs/browser-checks/render-settings-leftover-7825.js
  checks that row. Both browser-check gates pass locally.
- Tests: new engine/delete-leftover.win32-leftover-task-8471.test.js (5), selected for Windows CI by its name; the
  7820 test's expected partial-delete sentence updated.
macOS and Linux are unchanged.

## Decided, not missed
- Not in this change: create.js nameHeld on win32 (#8466's second half). It lands after this, now that the leftover
  can be seen and deleted.
- macOS has the same bug (a plist that will not move: the folder still trashed). Filed as #8474, not changed here.
- The weakest part: no server test checks that startsAtLogin reaches /api/removed; only the browser check covers the row.

## Measured on the Windows box
New file 5/5; negative controls: with origin's delete-leftover.js tests 1, 2, 4 and 5 fail (part 1 alone: 1 and 2; part 2
alone: 4 and 5), test 3 (the control) passes both ways. The 46 files that load delete-leftover or remove: 1437/116/25
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
