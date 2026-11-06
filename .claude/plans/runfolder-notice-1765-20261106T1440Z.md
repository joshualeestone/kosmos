# runfolder-notice-1765: kosmos#1765, the board says so when it runs from a folder others can change

**Posture:** production

**Card:** kosmos#1765, the board-side follow-up recorded on the card (comments 6682841166, 6684430147, 6687114787). #8108 made Kosmos.exe refuse to start from such a folder; a copy that already ran in place before #8108 keeps starting its board from there through its logon task, and the person is never told.

## What finished looks like (from the person's side)

1. On Windows, a board serving from a folder outside the person's profile that other accounts on the PC can change shows one plain notice on the board: that other people on this computer may be able to change the files Kosmos runs, and exactly what to do (download a fresh copy into a folder in their own user folder and open it; it installs itself and the old folder can then be deleted).
2. The normal install (inside the profile), and any board on a Mac or Linux, shows nothing and pays nothing: no PowerShell, no extra process.
3. The board keeps serving and the logon task is left alone. The notice can be dismissed for this start.

## Pieces

- `tools/windows/KosmosLauncher.cs` + `tools/windows/Kosmos.exe`: a `--check-run-folder` mode that runs `UnsafeRunFolderReason` on its own folder and prints one JSON line (`{"safe":true}` or `{"safe":false,"reason":...,"message":...}`), then exits; it starts nothing, shows nothing, and is handled before every other errand. One implementation of the rule, the one #8108 reviewed, rather than a second copy in the engine.
- `engine/win32runfolder.js`: `atStart()` asks the launcher once (only on win32, only when `win32board.bundleRoot()` is a folder outside the profile), with a time bound; `current()` and `dismiss()` for the route. Never fatal.
- `server.js`: the start hook beside storecheck's, `GET /api/board/run-folder` and `POST /api/board/run-folder/dismiss`.
- `web/index.html`: its own slot beside `damaged-slot`, painted from the route, with a dismiss button.
- Tests: the launcher mode (compiled probe, Windows only), the engine module (seams for the launcher call), the route, and a browser check for the notice.

## Decisions

- **Ask the launcher, do not port the rule.** The rule is long and was hardened over 8 review rounds; a second copy in JavaScript would drift. Rejected: reusing engine/win32recordacl.js (it counts any allowed entry, read included, and its wording is the release-key record's).
- **A notice, not a stop.** Stopping the board or the logon task would take a working Kosmos away mid-use with no visible undo. The fresh copy, once opened, repoints the logon task itself.
- **Checked once at start.** A folder's permissions do not change under a running board in any way this protects against.

## Weakest premise

A notice can be ignored, so the exposure lasts as long as the person waits. What would change it: evidence that real users run in place from shared folders, which would justify a harder stop with a one-click move.

## Validation (Windows box)

The launcher, engine and route tests with the no-schtasks preload; the browser check; verify-launcher.ps1; a live run of a board from an unsafe folder copy, if the box allows it without touching the fleet.
