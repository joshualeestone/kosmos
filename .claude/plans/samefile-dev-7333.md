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

## Review rounds
- Round 1: no blocker. [WARNING] ReFS / Dev Drive 64-bit serials may read at two widths (path vs handle), unmeasured (no admin) --> FIXED: on Windows the device compare uses the low 32 bits (sameDevice): equal on NTFS whatever the width, a different volume still differs unless two serials share their low 32 bits; test with controls. Still unmeasured on a real Dev Drive (stated). [NIT] stale comment above sameOpenedFile --> FIXED. [NIT] `platform` param --> kept: sameDevice uses it.
  Note: one run of bigint-ino.win32-7229 failed its three colliding-pair tests; two reruns passed 14/14. Those tests make files until two number ids collide (disk timing); not this change.
- Round 2: no blocker. [WARNING] the low-32 fallback broke for real 64-bit serials: a number dev above 2^53 has lost its low bits, so `>>> 0` is not the serial's low 32 bits (measured: 0x9a2b3c4d5e6f7a81 -> 1584363520 vs 1584364161), refusing the same file on most ReFS/Dev Drive volumes --> FIXED: the bigint stats already taken (exactPathStat, exactOpenedStat, exactOpenedStatAsync) now also carry a hidden devExact; on Windows sameDevice compares the low 32 bits of devExact when both sides have it, else of the number dev (exact below 2^53, as NTFS's 32-bit serial). [WARNING] the width test used a value below 2^53 --> FIXED: production-shaped test above 2^53, and a real path/handle test that devExact is carried and equal; both fail on the round-1 code.
- Round 3: [BLOCKER] the new real-file devExact test had no winOnly guard (off Windows EXACT_IDS is false, so no devExact: it would fail Mac/Linux CI) --> FIXED: winOnly. [NIT] one side with devExact, one without (the zip's unfingerprinted listing) falls back to the number dev's low 32 bits on both sides: same file still matches; the different-width case is the stated unmeasured round-1 gap. Production change otherwise clean (no false acceptance; non-Windows unchanged).
  Note: the three colliding-pair tests in bigint-ino.win32-7229 again failed once with "no colliding pair could be made on this disk" (their setup, disk id allocation), independent of this change.
- Round 4: no blocker, no warning (converged). [NIT] a no-op `* 1n` --> FIXED. [NIT] the real-file path/handle test checks an assumption, not the change --> ACCEPTED (its name says "what the compare relies on").

## Final ledger source
Rounds 1-4 above. Not measured: a real ReFS / Dev Drive volume (no admin to create one).
