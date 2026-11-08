# kosmos#8227 items 1 and 4 (Windows): network drives in `task files`, and the Windows CLI seam test

**Posture:** production

## Done looks like
- `kosmos task files` on Windows never opens a path on a drive mapped to a network share; it says NOT CHECKED with a reason, as it does for UNC.
- A remembered mapping whose server is gone, and a letter with no drive behind it, are not opened either.
- A drive whose kind cannot be read fails closed: nothing is opened, the reason is said in full once, then named.
- The Windows CLI's `task built --file` does not keep a path on a network drive (or on a drive whose kind cannot be read); the fingerprint still goes.
- A Windows-only test drives `pathRules.resolve` then `keptPath` under path.win32 for a drive path, a UNC path and a path through a folder link (junction), and runs on the Windows CI runner (file name carries win32).

## Design
- Drive kinds come from engine/windrives.js (#7232): one PowerShell call (GetDriveType as numbers, plus the redirector's EnumNetworkDrives, UTF-8), cached; it already reads a remembered mapping whose server is gone as remote, and a failed redirector read as unknown. New export `infoOf(letter)` gives the raw entry, since `placeOf` reads a share on this computer as local and this check never opens any network drive.
- `engine/tasklist.js driveRefusal(p, info)`: local opens; remote, absent (no drive there now) and unknown kinds are NOT CHECKED with words.
- `filesLines`: on win32, after the local check, ask the entry for the path's letter; null (kinds unknown) is said in full once, then named. Seam `opts.driveInfo`.
- Windows CLI `task built --file`: the same entry for a drive path that would be kept; anything but local keeps no path, and the line says why (network drive, drive not found, kind unreadable). Seam `o.driveInfo`. Cost: one PowerShell call (about 0.2 to 0.35 s here) per mark with a kept drive path.

## Rejected
- A second drive-type probe in tasklist (first draft): duplicated windrives and missed the disconnected-mapping case (review 1).
- fsutil fsinfo drivetype: 25 ms but localized text.
- windrives.placeOf: reads a share on this computer as local; this check refuses every network drive, as UNC is refused by name.
- Following links on Windows to catch a local link that points to a network share: left out (needs a link walk like reachesAutomount with junction, volume-GUID and \\?\UNC targets); a follow-up on the card.
- Checking on the board side: the board may be another computer.

## Measured (11-08, this Windows box)
- WebDAV-mapped X: reads DriveType 4. Old filesLines opened X:\report.txt (server logged PROPFIND + GET); new: zero requests, NOT CHECKED. Local C: file still matches. ~220 ms per run for the kinds.
- Worktree board + CLI, real kinds: `--file X:\report.txt` keeps no path; `--file C:\...` keeps it, and task files matches it.
