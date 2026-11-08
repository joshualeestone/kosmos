# kosmos#8227 items 1 and 4 (Windows): network drives in `task files`, and the Windows CLI seam test

**Posture:** production

## Done looks like
- `kosmos task files` on Windows never opens a path on a drive mapped to a network share; it says NOT CHECKED with a reason, as it does for UNC.
- A drive whose kind cannot be read fails closed: nothing is opened, the reason is said in full once, then named.
- The Windows CLI's `task built --file` does not keep a path on a network drive (or on a drive whose kind cannot be read); the fingerprint still goes.
- A Windows-only test drives `pathRules.resolve` then `keptPath` under path.win32 for a drive path, a UNC path and a path through a folder link (junction), and runs on the Windows CI runner (file name carries win32).

## Design
- `engine/tasklist.js driveTypesHere(platform, run)`: one PowerShell call per run, `[IO.DriveInfo]::GetDrives()` as letter + numeric DriveType (numbers, because fsutil's words are localized). Map, empty Map off Windows, null when unreadable.
- `driveRefusal(p, types)`: open Fixed/Removable/CDRom/Ram, and a letter Windows does not list (no drive behind it); refuse Network (4) and Unknown (0).
- `filesLines`: on win32, after the local check, read the types lazily once; null -> NOT CHECKED (said once); refused -> NOT CHECKED with words.
- Windows CLI `task built --file`: after keptPath, the same check on a drive path; any failure keeps no path (fail closed). Seam `o.driveTypes`.

## Rejected
- fsutil fsinfo drivetype: 25 ms but localized text.
- Following links on Windows to catch a local link that points to a network share: left out (needs a link walk like reachesAutomount with junction / volume-GUID / \\?\UNC targets); a follow-up on the card.
- Checking on the board side: the board may be another computer.

## Measured (11-08, this Windows box)
- WebDAV-mapped X: reads DriveType 4. Old filesLines opened X:\report.txt (server logged PROPFIND + GET); new: zero requests, NOT CHECKED. Local C: file still matches. ~220 ms per run for the kinds.
- Worktree board + CLI, real kinds: `--file X:\report.txt` keeps no path; `--file C:\...` keeps it, and task files matches it.
