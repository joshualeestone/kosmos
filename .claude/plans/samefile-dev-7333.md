# #7333: sameOpenedFile compares the device on Windows too

**Posture:** production

## Problem
engine/projects.js `sameOpenedFile` (the check that the file opened is the file the gates walked: downloads, previews,
zips, attachment streams) skipped the device compare on Windows after the ids matched. NTFS file ids are numbered per
volume, so an equal id on another volume is another file; a swap onto another volume with an equal id would pass.

## Measured (the card's first ask)
On this Windows box, node 24: `st.dev` is the volume serial and is identical between `fs.statSync(p)` and
`fs.fstatSync(fd)` of the same file for a plain drive path, a `\\?\` spelling, a junction and a subst letter (bigint and
number). A mount point and a share could not be made without admin; libuv stats a path by opening a handle and filling
the stat from the same per-handle record fstat uses, so both reads of one file report one volume serial there too.

## Change
Both identity branches return `gated.dev === opened.dev` on every platform. The no-inode branch (FAT/exFAT, ino 0) is
unchanged (size and times).

## Tests
- bigint-ino.win32-7229: exact ids equal on two volumes -> refused (control: same volume -> same file); a real file by
  path and by handle has one device and is the same file.
- projects.download.win32-5165 W6: Windows now refuses equal number ids on two devices (was asserted to pass), with a
  same-device control.
Both fail on origin/main's projects.js. Neighbouring suites (files-preview-4997, preview-sweep-5254,
attachment-stream-6734, filebrowser-6724, win32-reveal) fail exactly the same tests by name with main's code.
