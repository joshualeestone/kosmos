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
