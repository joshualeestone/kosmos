# win-leftover-8471: Kosmos stops making invisible Windows leftovers, and its task-only delete is guarded (kosmos#8471, part 1)

**Posture:** production

## Problem
On Windows a leftover Kosmos Scheduled Task with no agent folder shows nowhere on the board, so nobody can delete it
from the screen. Kosmos made that state itself: a delete whose win32job.remove failed still sent the folder to the
Recycle Bin, kept the settings and forgot the removal (the review-33 keep-the-folder guard covered Linux units only).

## Change (narrowed after review 9; see the log)
- engine/delete-leftover.js, the keep-the-folder guard: it covers a Windows task too. When Task Scheduler will not
  remove the task, the delete stops whole (folder, settings, removal record, tokens kept), so the agent stays visible
  and the delete can be retried. The sentence is the Linux one in Windows words, plus a way out if the refusal lasts
  (delete agent-<name> in the Kosmos folder of the Task Scheduler Library, then try again here).
- plan() for a Windows task with no folder (reached from a removed agent's row, as on main): it gets the checks settings
  alone get (strandedRefusal: a name waiting to start, a recorded folder behind a link that leads nowhere, a damaged
  settings file), and refuses while the folder Kosmos keeps its agents in leads nowhere, cannot be checked, or is not
  there at all (every agent would read as a leftover then), with the same way out. Its sentence and button say the
  settings go for good ("Its startup job is removed. Its settings are deleted for good."; "Remove its startup job and
  delete its settings") instead of a false reason.
- Tests: new engine/delete-leftover.win32-leftover-task-8471.test.js (7), selected for Windows CI by its name; the
  7820 test now pins the refusal sentence (it pinned the partial-delete one).
- NOT in this change: listing a task with no folder in the removed list (#8471's second part). Moved to a follow-up card.
macOS and Linux are unchanged.

## Decided, not missed
- Listing dropped. Nothing can tell a DELETED agent folder from one renamed or moved elsewhere, so a list of "tasks with
  no folder" offers deletes that lose settings for good for agents that can come back. Rounds 4 to 9 each found another
  such case (a dead link, a missing drive, a missing folder, a renamed folder plus one create); a heuristic patched each
  time is not a design. Rejected: a seventh patch. What would make a listing safe: a delete through it that is fully
  recoverable (remove the task only, keep the settings for their own Recycle Bin row, no community account retired).
- macOS: #8474 was closed as not planned (the Mac board already shows a stopped agent with a plist and no folder).
- The weakest part: a removed agent whose recorded folder is outside the workers folder on a drive that is not
  connected still reads as gone, so its task-only delete is offered and its settings go for good (as on main; review
  10; on #8475). Also, an existing invisible leftover (made before this change) still has no Delete on the screen; only
  Task Scheduler removes it. This change stops new ones; the follow-up card owns the rest. #8466's nameHeld half waits.

## Measured on the Windows box
New file 7/7, each test alone, with and without the preload. Negative control, with origin's delete-leftover.js: the
five tests of a fix fail (1, 2, 4, 5, 6); the control (3) and the no-listing pin (7) pass on main, as they should.
delete-leftover.test 70/0/10, the 7820 file 34/0/1, policy tests pass.

## Review log (short)
- Round 1: a false reason in the task-only sentence (fixed, keeping #7820's design: settings go for good, name typed);
  "try again in a moment" given a Task Scheduler way out.
- Round 2: the button names the settings; plainer task directions.
- Round 3: one "and" per sentence; plan's weakest part corrected.
- Round 4: a workers folder behind a dead link made every agent deletable: refused.
- Round 5: a workers folder not there at all, same: refused, with a way out.
- Round 6: the listing showed the whole fleet in those states: hidden (since removed with the listing).
- Round 7: tests depended on order: fixed.
- Round 8 (the fleet cap): a renamed workers folder made every agent deletable. I rated it a BLOCKER (the change would
  have added a data-loss path main does not have), which let the loop pass the cap; my fix assumed an empty remade
  folder.
- Round 9: that premise was false (the next create makes an agent folder in it at once); the reviewer deleted a whole
  fleet's settings in a sandbox. This showed my understanding of the listing was wrong, so I stopped that line: the
  listing, its server field, its screen row and its tests are reverted to main, and the flawed "empty" check removed.
- Round 10 (on the narrowed diff; no blocker; 1 warning, 2 conventions, 2 nits). Nothing in the diff is more
  destructive than main. The warning (a recorded folder on an unconnected drive outside the workers folder reads as
  gone, so its settings can go for good) is the same on main: named in the code comment and above, carded on #8475.
  Conventions fixed after round 10, COMMENT-ONLY (no code changed): the test header no longer describes the reverted
  listing; a leftover clause ("reachable since #8471") dropped; the plan() comment no longer claims coverage it lacks.
  Loop stopped here by the fleet's 8-round rule (no blocker open): converged: false.
