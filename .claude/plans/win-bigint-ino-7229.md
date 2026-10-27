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
The gated side reads the path twice (a number stat, then a BigInt stat for the exact id). The two reads are checked
to be the same file by the number id only, which a colliding file satisfies; creation time cannot help (colliding files
are often made in the same clock tick, measured 0 ns apart), and deriving the number stat from the BigInt one would
change the float times the FAT/exFAT rule compares. So a colliding file swapped in at the same name within the
microseconds between the two reads would carry its own id. Downstream (realpath, the folder prefix, sameListedPath, the
zip size) it can only be a regular file at the same listed name inside the folder (review 2).

## Review rounds
- Round 1: 3 BLOCKERs, 1 WARNING, 1 NIT. BLOCKERs FIXED: (1) the zip's first check compared the listed entry's plain
  lstat (browsedEntry), so a colliding file swapped in after the listing passed (reviewer made it with a real pair);
  browsedEntry's files now carry the exact id. (2) the second path read compared size too, so a file being written to
  read as another file in 180,831 of 188,930 reads (preview/download refused); only the id is compared now. (3) node
  fills BigInt stats from a signed 64-bit array, so an id whose top bit is set (NTFS sequence >= 0x8000) read negative
  and every such file would be refused; all three readers take BigInt.asUintN(64). WARNING FIXED: \work and /work
  (rooted, current drive) are allowed again. NIT (dev ids skipped on Windows, pre-existing): noted for a card.
  Negative control: the 4 new tests fail on round 0. 8/8; 87 win32 files 1596 tests, 0 fail.
- Round 2: no BLOCKER (every gated stat traced to sameOpenedFile, none rebuilt; 30,090 real files never read as
  NO_FILE; a share spelling of a local file matches its drive path). 1 WARNING, 3 NITs. WARNING FIXED: moveFolder now
  applies the create-time Windows folder rule. NITs FIXED: the file-hash key and the PDF preview stamp include the exact
  id when present; a test world with no lstat/stat reads the real disk exactly. NIT ACCEPTED (Weakest part): the two
  reads of a path agree on the number id only; tried creation time, which cannot tell colliding files apart (measured
  0 ns), so removed. 9/9.
- Round 3: 1 BLOCKER, 1 NIT. BLOCKER FIXED (reproduced by the reviewer): round 1 gave listDir rows the exact id, so their
  fingerprint job key carried it, but hashOne compared against a plain fstat, so on Windows a listDir row (the agent
  Files browse) never got a sha256. A job now records whether its key carries the exact id, and hashOne reads that id
  from the same handle when it does (inline: filehash cannot require projects); listFiles jobs compare as before. New
  test: listDir and listFiles rows both get sha256 on Windows (fails on round 2). NIT noted: listFiles' walk stat has no
  exact id; making it exact now also works, since hashOne follows the job. Not stored anywhere: the hash cache is in
  memory, the preview stamp only names a PNG, so a changed key costs one recompute. 20/20 with filehash-6761.
- Round 4: 1 BLOCKER (reproduced against an origin/main control). listFiles built its rows from a plain stat and listDir
  from an exact one, so their fingerprint keys for the same file never agreed and the one-key-per-path cache evicted
  each other: on Windows the agent Files screen (and a project's list beside its browser) rehashed every listed file on
  every poll and the sha never stayed. listFiles now builds its stats exactly too; every stat that reaches the
  fingerprint cache on Windows carries the exact id. Test: alternating the two lists keeps the sha on both and hashes
  once (on round 3 it flips every tick). Every other consumer checked consistent. 21/21 with filehash-6761.
- Round 5: no BLOCKER. End to end through the real board routes on this box with real colliding pairs (records
  recycled until ids passed 2^53): origin/main SERVES the swapped colliding file on download and preview and puts its
  bytes in a zip; the branch refuses all three; ordinary list/browse/preview/download/zip unchanged. WARNING FIXED:
  listFiles gave every WALKED file a second (BigInt) stat, 1.3-1.85x slower on 2000 files; now only the shown rows
  (after sort and cap) get the exact id. NITs: the two-read residual (already in Weakest part); a swap at download says
  "not there any more" (wording, left). Test gap found: the collision tests depend on this disk having ids past 2^53;
  on four later runs none collided and those tests SKIPPED (stated reason). A helper that recycles records to raise
  sequence numbers (as the reviewer did) would make them run every time: follow-up.
- After round 5: the collision helper now recycles a pool of 64 files (made and deleted up to 48 times) when the disk
  has no ids past 2^53 yet, since a record's sequence rises on each reuse and ids pass 2^53 at sequence 32; neighbouring
  records then round alike. The collision tests now run every time: 11/11, 0 skipped, three runs, about 4 s each; with
  main's diagnostics.js and filehash.js the board-log collision test fails on the real pair.
