# win-recoverable-8475: a Windows startup task left with no folder can be seen and removed, recoverably (kosmos#8475)

**Posture:** production

## Problem
On Windows a Kosmos Scheduled Task with no agent folder showed nowhere on the board, so nobody could remove it from the
screen. #8476 (#8471 part 1) stopped Kosmos making new ones but did not list existing ones, because its listing's delete
lost the settings for good, and nothing can tell an agent folder that was DELETED from one renamed or moved elsewhere:
nine review rounds kept finding healthy agents that read as "no folder" (a dead junction, an unplugged drive, a missing
workers folder, a renamed workers folder plus one create, a recorded folder on an unconnected drive).

## Change (Windows only; macOS and Linux unchanged)
- engine/delete-leftover.js settingsLeftovers: on win32 it also lists a name with a profile, no folder and a task known
  to be registered (job === true; a failed look lists nothing), not removed, not running, not waiting to start, while
  the workers folder is there; marked startsAtLogin. server.js /api/removed passes it; web/index.html's row says "Its
  startup job is still set up, but Kosmos cannot find its folder" (true whether the folder was deleted or moved).
- plan() and del() for a Windows task with no folder: a taskOnly delete that removes ONLY the Scheduled Task. It keeps
  the settings and picture, revokes no tokens, clears no history, retires no community account, resets no standing,
  records no removal, and asks for no typing. Afterwards the name is a settings-only row whose delete goes to the
  Recycle Bin. The sentences say exactly that, and how to get the agent back if its folder was only moved (put it back
  at the recorded path, Restore it first if removed, then Start at login when Kosmos offers it: register.survey's
  missing list and register.repair, which re-registers the task).
- It still refuses while the name is waiting to start, and while the whole workers folder is missing or behind a dead
  link (the way-out sentence names the task to delete in Task Scheduler).
- Tests: new engine/delete-leftover.win32-recoverable-task-8475.test.js (5); the 8471 file's tests updated to the new
  rule (test 7 now pins "Windows lists the task, marked; macOS and Linux do not"); the 7820 pin updated; a Windows-only
  server.test.js test for startsAtLogin; docs/browser-checks/render-settings-leftover-7825.js asserts the row.

## Decided, not missed
- Every Windows task-with-no-folder delete is now taskOnly, including the one reached from a removed agent's row, which
  used to delete the settings for good after a typed name: plan() knows the name, not the row clicked, and an action
  taken on an inference that a move can fake must be recoverable. A removed agent's leftover now takes two clicks (the
  task, then the settings, to the Recycle Bin). Would change my mind: a need for a one-step delete there.
- The weakest part: the way back appears only for an agent that has run on this computer (register.survey's hasRun);
  and an agent whose recorded folder is on a disk not connected shows no settings-only row after its task goes (safe,
  but its settings cannot be deleted from the screen until the disk returns).

## Measured on the Windows box
New file 5/5 (0/5 with main's source). 8471 file 7/0, 7820 file 34/0/1, delete-leftover.test 70/0/10, server
"removed list" 3 pass; each changed test fails on main's source. Both browser-check gates exit 0. Policy tests pass.
