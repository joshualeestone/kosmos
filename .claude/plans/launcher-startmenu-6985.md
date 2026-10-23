# launcher-startmenu-6985: the board window sends a person to the Start menu, not Kosmos.exe

Card: #6985 (launcher half; the web/index.html half is Mona Lisa's, a separate PR).

**Posture:** production

## Done when
- The three user-facing launcher messages (NotConfirmedPage, BrowserUnknownMessage, BrowserNotConfirmedMessage) say
  "open Kosmos from the Start menu again in a minute" and no longer name Kosmos.exe.
- The committed Kosmos.exe is rebuilt from the committed source with the README's csc flags, signed (Valid, Kosmos
  Agent Manager, Inc.), and tools/windows/verify-launcher.ps1 ends OK.
- Tests pinning these strings are updated, fail on origin/main's strings, and pass here.

## Change
- tools/windows/KosmosLauncher.cs: the three strings, as above. Comments that quoted the old wording updated to match.
  A comment above them records why Start menu alone is right. No other string changed.
- tools/windows/Kosmos.exe: rebuilt (README csc flags) and signed with this box's signing wrapper.
- tools.win-launcher-reproof-6882.test.js: the #6882 pin now expects the Start menu wording; a new #6985 test covers
  all three constants (Start menu wording, no Kosmos.exe, no em dash) and pins the ordering the decision rests on.

## Decision: Start menu alone, no Kosmos.exe fallback
The zip's READ ME keeps one fallback ("If Kosmos is not in the Start menu yet, double-click Kosmos.exe in the extracted
folder once more") for a first run that never got as far as the Start menu (SmartScreen's "Don't run": the launcher
never ran). None of these three messages can be shown in that case:
- they are shown only by the window process (RunBoardWindow: NotConfirmedPage in the window, the two boxes in its
  browser fallback);
- the window is started in exactly one place, Main, through BoardWindowStartInfo(here);
- Main reaches that only after RunInstallerDuties returned null, and for a real build (IsKosmosBuild) the one path
  that returns null (the end of RunInstallerDutiesUnderLock) calls refreshWindowsRegistration(here), which writes the Start menu shortcut pointing at the copy that runs; every other
  path (install, update, hand-off) starts the installed copy, which runs the same Main.
So whenever one of these is on screen, the Start menu shortcut has just been written for the copy that is running.

Rejected: keeping a "or Kosmos.exe in the extracted folder" fallback. It would point people back at the extracted folder,
which the READ ME never sends them back to after the install (it says the zip can be deleted), for a case that
cannot reach these messages.

Weakest part: RefreshStartMenuShortcut can fail silently at a desktop (no box by design). Then the Start menu has no
Kosmos entry and the message points at nothing. That is rare (IShellLink in the per-user Programs folder), and it is
the same assumption the READ ME's "Always open Kosmos from the Start menu" makes. A copy that is not a real build (no
manifest.json: dev or test folders) also never writes the shortcut, but no person runs one. Would change my mind: a
report of a missing shortcut on a real install, or a second caller that starts --window.

Not changed (outside this card's ask): WindowStoppedMessage ("Double-click Kosmos.exe, or choose Kosmos in the
Start menu"), the window's "Kosmos could not start on this computer (...). Double-click Kosmos.exe to try again."
(connect-mode restart), Main's "Kosmos stopped unexpectedly (exit code N). Double-click Kosmos.exe to try again."
(which goes on to send the person to that folder to run it with --console), and the "Double-click Kosmos.exe in
<folder>" notes (installer duties, RelaunchFailedMessage), which name a specific folder on purpose. The first three are
candidates for a follow-up card.

## Verified on the Windows box
- csc (README flags) exit 0; sign.ps1: status Valid, signer Kosmos Agent Manager, Inc.; verify-launcher.ps1 OK.
- Launcher test files (13 files, preload on): branch 256 tests, 254 pass, 0 fail, 2 skip; origin/main 255 tests, 253
  pass, 0 fail, the same 2 skips by reason (#4495 absolute claim dir, #5645 no 8.3 names). The branch's test file run
  against origin/main's source: the #6882 pin and the new #6985 test both fail on the old strings.
- Mutation checks: an early `return null` before the refresh in RunInstallerDutiesUnderLock, and a call to
  OpenInBrowserInstead from Main, each turn the #6985 test red.
- Final Kosmos.exe sha256 c8f9dfd1de536fd4e4fc47e59cd6c524dc891c0411797e7747dfd497cd3882af, signature Valid
  (Kosmos Agent Manager, Inc., timestamped), verify-launcher.ps1 OK.
- tools/windows-tests.js (every win32/windows file, preload on), branch and clean origin/main: 194 files passed on
  both, and the same 5 non-passing entries on both (setupsettings.fsync-5434 red on this box; 4 ALL_SKIP_OK entries
  stale because this box has agy and codex installed), as recorded for #6882.
