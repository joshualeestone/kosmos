# #3324: Turn On brings the Windows sleep Settings window in front of Kosmos

**Posture:** production

## Done looks like
On Windows, pressing Turn On on the first-run sleep step opens Settings > Power & sleep
IN FRONT of Kosmos, not behind it in the taskbar. Proven live on the Windows box with a
window the test did not start in front, and a control (the old helper) that fails the
same check.

## What was wrong (measured on the Windows box, 2026-10-02)
Two independent bugs in `engine/win32explorer.js` `foregroundSettings`; either alone
leaves the window behind:
1. **The helper never ran.** It was spawned `detached: true`. On Windows that is
   DETACHED_PROCESS (no console), and powershell.exe 5.1 started that way exits 0 in
   ~65 ms without running a line. Matrix: detached+hide, detached = no effect;
   non-detached hidden = runs.
2. **It looked for the wrong window.** It searched `SystemSettings` for a
   `MainWindowHandle`. On Windows 11 that is 0: the top-level window is an
   `ApplicationFrameWindow` owned by ApplicationFrameHost, with a CoreWindow child owned
   by SystemSettings.

## Change
- Spawn options become an exported frozen `FOREGROUND_SPAWN_OPTIONS`
  (`detached: false, windowsHide: true, stdio: 'ignore'`), still `unref()`ed.
- The script finds the visible `ApplicationFrameWindow` whose child belongs to a
  SystemSettings pid (C# `FrameOf` via EnumWindows/EnumChildWindows); title is not
  matched (localized). Frames SystemSettings owns itself are skipped and there is NO
  MainWindowHandle fallback (see "Cold launch" below).
- The helper stands down when the foreground is already the frame, the host
  (ApplicationFrameHost) or SystemSettings.

## Cold launch (found by the stand-in rig after the PR opened, 2026-10-02 ~10:50)
The 10-01 stand-in rig (work\scratch-3324\proof.ps1: a WinForms "Kosmos" window really
clicked, then Turn On through the engine code) showed the first PR version leaving NO
window focused on a cold Settings launch, every run, while the old (never-running) helper
left Settings focused. Logged cause: during a cold launch SystemSettings owns a temporary
window of the same class, and its MainWindowHandle points at it; the helper's fallback
raised that window while the host's real frame was already activating, breaking the
handover. Fixed by skipping self-owned frames, dropping the fallback, and standing down
when Settings is already in front. After: cold 4/4, warm 2/2, File Explorer in front 2/2,
minimized 1/1, short-lived parent 2/2, all ending with Settings focused and no
no-focus flicker. Note: this rig does NOT reproduce the original FAIL (the old code
passes it now), so it proves "no regression", not "fixes the original"; the File
Explorer test is the one where the old code fails and the fix passes.
- Test pins both (`machine.win32-sleep.test.js`); the new assertion fails on the old code.

## Rejected
- A synthetic key press (F24) before SetForegroundWindow to beat the foreground lock:
  measured unnecessary (raised 3 of 3 without it, with a File Explorer window in front),
  and it would inject input into whatever has focus.
- Matching the frame by title "Settings": localized.

## Weakest part
The live proof called the engine's own `foregroundSettings()` with the real
`child_process.spawn` and the frozen options (scratch driver requiring
engine/win32explorer.js), but from my agent's process tree (started by a logon
scheduled task), not from inside the board process itself, with Notepad or File Explorer in front rather than
the Kosmos app window. The foreground lock could in principle treat the board
differently. A full first-run visual check through a board is the follow-up proof.
Also: if a suspended Settings CoreWindow is ever detached from its frame, FrameOf finds
nothing and the helper gives up after 5 s (the pre-fix state). Settings already open and
minimized was checked live and restored + raised; the board check should repeat it.
**So the PR says Addresses #3324, not Closes: the issue closes only after the board-level
first-run check passes on this box** (Turn On, Settings in front; Settings maximized
stays maximized; Settings minimized comes back).

Rejected in review: a second fallback that raises any EMPTY ApplicationFrameWindow (the
suspended-frame case). It cannot tell Settings' empty frame from another packaged app's,
so it could raise the wrong window; doing nothing leaves the pre-fix state, the safer
failure.

## Review-loop changes
- Restore (SW_RESTORE) only when IsIconic, so a maximized Settings is not shrunk.
- `setSpawnForTests` seam below the live gate; the test asserts the options the real
  launch receives (a reintroduced `detached: true` goes red, checked).
- The not-detached child is in libuv's kill-on-close job, so it dies with the board;
  the comment says so (acceptable: a few seconds of life).

## Out of scope (follow-up)
"Check again / Turned it on? Tap to check." still showing when sleep is already off, and
the faint running mark on the taskbar picture in light mode. Both are in the shared
Mac/Windows first-run UI; the wording came from #2647.
