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
  matched (localized). Falls back to SystemSettings' own MainWindowHandle if one exists.
- Test pins both (`machine.win32-sleep.test.js`); the new assertion fails on the old code.

## Rejected
- A synthetic key press (F24) before SetForegroundWindow to beat the foreground lock:
  measured unnecessary (raised 3 of 3 without it, with a File Explorer window in front),
  and it would inject input into whatever has focus.
- Matching the frame by title "Settings": localized.

## Weakest part
The live proof ran from my agent's process tree (started by a logon scheduled task),
not from the board process itself, with Notepad or File Explorer in front rather than
the Kosmos app window. The foreground lock could in principle treat the board
differently. A full first-run visual check through a board is the follow-up proof.

## Out of scope (follow-up)
"Check again / Turned it on? Tap to check." still showing when sleep is already off, and
the faint running mark on the taskbar picture in light mode. Both are in the shared
Mac/Windows first-run UI; the wording came from #2647.
