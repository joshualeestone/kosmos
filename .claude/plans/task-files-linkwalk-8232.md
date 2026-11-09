# task-files-linkwalk-8232: Windows task files never opens a network location through a link (kosmos#8232)

**Posture:** production

Follow-up to #8227 item 1. On Windows, `kosmos task files` checked only a path's own leading drive letter
(driveRefusal over engine/windrives.js). A link inside a local path still opened a network location at a path a
marker chose: a directory symlink to `\\host\share` or `\\?\UNC\...`, or a symlink or junction to a mapped network
letter.

## Change (engine/tasklist.js)
`reachesNetworkWin(p, driveInfo, fsx)`, the Windows counterpart of `reachesAutomount`:
- `p` is normalised by text first (`path.win32.normalize`), because Windows collapses `.` and `..` before it walks a
  path, so `C:\link\..\x` never follows `link`.
- Walked one name at a time with lstat. A link is followed one hop at a time by reading it (never resolved):
  - a UNC target (`\\host`, `\\?\UNC\`, `\\.\UNC\`, `\??\UNC\`) is refused as a network location;
  - every other `\\?\`, `\\.\` or `\??\` device or volume path is refused as one it cannot follow. node's readlink
    returns these raw (it strips `\??\` only from a drive or UNC target), e.g. `\??\GLOBALROOT\Device\Mup\...` (a
    network share by another name) and `\??\Global\Z:\` (a mapped letter by another name). A volume GUID target is
    not a drive path the drive table can check either; decided: not opened, not called network;
  - `\\?\C:\x` and `\??\C:\x` are the drive path `C:\x`;
  - a drive-letter target is checked with driveInfo/driveRefusal BEFORE anything on that drive is looked up;
  - a drive-relative target (`C:x`) is not followed;
  - a rooted target (`\x`) is refused: readlink gives the same text for a relative-flag `\x` and for an absolute NT
    target such as `\Device\Mup\host\share`, and anyone may create `C:\Device\...`, so no lookup can tell them apart;
  - a relative target is joined to the link's folder;
  - the rest of the path is joined to the target, normalised again, and the walk restarts.
- More than 40 hops is a loop; an unreadable link is not opened. Every accepted target (a drive path or a relative
  name) is resolved as Windows resolves it, so a name that is not there (ENOENT/ENOTDIR) ends the walk and compare
  reports it MISSING, link or not (a file gone from behind a junction stays a MISSING verdict). Any other lstat error
  after a link is not opened.
- The walk and the open are separate steps; a link swapped between them needs write access to the path's own
  folders on this computer, and is not caught.
- Wired into `filesLines` after the drive-letter check; `opts.fs` is the test seam.

Scope: `task files` (the open of a path a marker chose). `task built --file` keeps the marker's own path on the
marker's own computer, which is not a marker-chosen open, so it is unchanged.

## Tests
`cli.task-files-win32-8232.test.js`: the rules on any host against a scripted filesystem (every lstat recorded,
so "nothing past the link was looked up" is asserted), and real junction/symlink arms on Windows (a symlink needs
Developer Mode or an elevated runner; it skips with a reason otherwise).

## Measured by hand (Windows 11 box, 11-09)
WebDAV rig (`net use X: http://localtest.me:8766/`, server logs each request): links on C: to `X:\` and to
`\\localtest.me@8766\DavWWWRoot`. origin/main's tasklist opened both (GET + PROPFIND); the new one sent 0 requests and
still opened a junction to a local folder.
