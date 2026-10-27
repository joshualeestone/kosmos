# win-bigint-ino-7229

**Posture:** production

Addresses #7229: on Windows an NTFS file id is 64-bit, but `fs.stat().ino` is a JS number (53 bits), so two different
files can share a `st.ino` (measured on this box: 19 pairs among 2000 fresh files; the new test finds one every run).
Identity checks that decide "same file" are made exact, and project create refuses folders in a non-drive, non-share
namespace.

## Done when (from the card)
1. Every engine identity compare that matters on Windows uses exact ids, or is shown to be log/cache only.
2. A Windows test makes a real collision for each fixed site that a test can reach.
3. Project create refuses folders in a namespace that is not a drive or a share.

## Audit (47 reads of `.ino` in 30 engine files)
Already exact: backupdevicekey, backupsnapshot, backupsessions, chat, installroot, restoresink, restoreworld,
sendertoken, discover, replyfile. MATTERS and fixed here: projects.sameOpenedFile (the download/preview/zip guard),
projects folder browse (#6724, before/after), store avatar save, setup-assistant guard-state delete,
diagnostics.readBoardLog. LOW (cache or change hints, revalidated, or failing safe): logstamp, undo, codexsession,
messages, usage, groklimits, filehash, filepreview cache keys, communitysend, projectborn, orgchartcodex, subscription,
webhooks, usageproviders.

## Changes
- engine/projects.js: on Windows a path stat (statOfFolderPath, lstatOfFolderPath) carries a hidden `inoExact` from a
  BigInt stat of the same path; if that second read is not the same file (number id or size differs) it carries an id no
  file has. exactOpenedStat / exactOpenedStatAsync attach it from the SAME descriptor (no race). sameOpenedFile compares
  `inoExact` when both sides carry one (non-zero); otherwise its old rules (FAT's inode 0 included). Number stats are
  unchanged (rows and JSON never see a BigInt). Folder browse reads BigInt lstats before and after.
- engine/filepreview.js, server.js (download route and zip): the opened side takes exactOpenedStat.
- engine/store.js (avatar), engine/setup-assistant.js (guard file), engine/diagnostics.js (board.log): BigInt stats.
- Project create, on Windows: a folder must read as a drive (C:\, \\?\C:\, \\.\C:\) or a share (\\host\share in any
  spelling); anything else (\\.\pipe, \\.\COM1, GLOBALROOT, Volume{GUID}) is refused before it is resolved.

## Verification
- engine/bigint-ino.win32-7229.test.js on the Windows box: 4/4, none skipped (a colliding pair is found each run). The
  download guard refuses B for A, and its control shows number stats alone are fooled; the log reader refuses a colliding
  file (fails on main's diagnostics.js); a stat whose second read is another file never matches; create's spellings.
- 87 engine/*win32*.test.js under the schtasks guard: 1592 tests, 0 fail.

## Not tested with a real collision (stated, not hidden)
The avatar save (fixed file names), the folder-browse before/after (needs a folder swapped mid-read) and the setup
guard delete (a microsecond race) are direct BigInt conversions of a local compare; no test makes their collision.

## Split out
The share-folder items added to the card in comments (refuse an agent's share-folder project unless the person
confirms; flag existing rows a #7243 board cannot place) are a policy change with a person-confirmation path: filed as
their own card rather than grown into this one.

## Weakest part
The gated side reads the path twice (number, then BigInt); a swap between the two reads is caught only when the number
id or size differs, which a colliding same-size file would not. That needs a collision AND a swap inside microseconds.

## Review rounds
- Round 1: 3 BLOCKERs, 1 WARNING, 1 NIT. BLOCKERs FIXED: (1) the zip's first check compared the listed entry's plain
  lstat (browsedEntry), so a colliding file swapped in after the listing passed (reviewer made it with a real pair);
  browsedEntry's files now carry the exact id. (2) the second path read compared size too, so a file being written to
  read as another file in 180,831 of 188,930 reads (preview/download refused); only the id is compared now. (3) node
  fills BigInt stats from a signed 64-bit array, so an id whose top bit is set (NTFS sequence >= 0x8000) read negative
  and every such file would be refused; all three readers take BigInt.asUintN(64). WARNING FIXED: \work and /work
  (rooted, current drive) are allowed again. NIT (dev ids skipped on Windows, pre-existing): noted for a card.
  Negative control: the 4 new tests fail on round 0. 8/8; 87 win32 files 1596 tests, 0 fail.
