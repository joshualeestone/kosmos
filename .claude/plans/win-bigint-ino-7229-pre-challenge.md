---
pre_challenge: true
method: challenge-loop
branch: win-bigint-ino-7229
diff_hash: da35371f9d931c9af708c858fdcb23193e41af42f1ade0962b1b2e5342daca38
validation: engine/bigint-ino.win32-7229.test.js 11/11 with real colliding NTFS ids on the Windows box (0 skipped), filehash-6761 (rebased onto main after the 0.7.71 hold); 87 win32 files + filehash + filepreview 1609 tests 0 fail; end to end (review 5): main serves a swapped colliding file on download/preview/zip, the branch refuses; full suite via CI
subdir_audit: passed
timestamp: 2026-10-27T15:14:32Z
iterations: 6
converged: true
---

# Pre-PR review proof: win-bigint-ino-7229

**Iterations:** 6
**Converged:** Yes. The last round found no BLOCKER; anything it raised is recorded below.
**Per-round record:** .claude/plans/win-bigint-ino-7229.md

## Rounds

#### Iteration 1
- Round 1: 3 BLOCKERs, 1 WARNING, 1 NIT. BLOCKERs FIXED: (1) the zip's first check compared the listed entry's plain
  lstat (browsedEntry), so a colliding file swapped in after the listing passed (reviewer made it with a real pair);
  browsedEntry's files now carry the exact id. (2) the second path read compared size too, so a file being written to
  read as another file in 180,831 of 188,930 reads (preview/download refused); only the id is compared now. (3) node
  fills BigInt stats from a signed 64-bit array, so an id whose top bit is set (NTFS sequence >= 0x8000) read negative
  and every such file would be refused; all three readers take BigInt.asUintN(64). WARNING FIXED: \work and /work
  (rooted, current drive) are allowed again. NIT (dev ids skipped on Windows, pre-existing): noted for a card.
  Negative control: the 4 new tests fail on round 0. 8/8; 87 win32 files 1596 tests, 0 fail.

#### Iteration 2
- Round 2: no BLOCKER (every gated stat traced to sameOpenedFile, none rebuilt; 30,090 real files never read as
  NO_FILE; a share spelling of a local file matches its drive path). 1 WARNING, 3 NITs. WARNING FIXED: moveFolder now
  applies the create-time Windows folder rule. NITs FIXED: the file-hash key and the PDF preview stamp include the exact
  id when present; a test world with no lstat/stat reads the real disk exactly. NIT ACCEPTED (Weakest part): the two
  reads of a path agree on the number id only; tried creation time, which cannot tell colliding files apart (measured
  0 ns), so removed. 9/9.

#### Iteration 3
- Round 3: 1 BLOCKER, 1 NIT. BLOCKER FIXED (reproduced by the reviewer): round 1 gave listDir rows the exact id, so their
  fingerprint job key carried it, but hashOne compared against a plain fstat, so on Windows a listDir row (the agent
  Files browse) never got a sha256. A job now records whether its key carries the exact id, and hashOne reads that id
  from the same handle when it does (inline: filehash cannot require projects); listFiles jobs compare as before. New
  test: listDir and listFiles rows both get sha256 on Windows (fails on round 2). NIT noted: listFiles' walk stat has no
  exact id; making it exact now also works, since hashOne follows the job. Not stored anywhere: the hash cache is in
  memory, the preview stamp only names a PNG, so a changed key costs one recompute. 20/20 with filehash-6761.

#### Iteration 4
- Round 4: 1 BLOCKER (reproduced against an origin/main control). listFiles built its rows from a plain stat and listDir
  from an exact one, so their fingerprint keys for the same file never agreed and the one-key-per-path cache evicted
  each other: on Windows the agent Files screen (and a project's list beside its browser) rehashed every listed file on
  every poll and the sha never stayed. listFiles now builds its stats exactly too; every stat that reaches the
  fingerprint cache on Windows carries the exact id. Test: alternating the two lists keeps the sha on both and hashes
  once (on round 3 it flips every tick). Every other consumer checked consistent. 21/21 with filehash-6761.

#### Iteration 5
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

#### Iteration 6
- Round 6: no BLOCKER (every shown listFiles row that reaches a fingerprint carries the exact id; rows past the cap
  leave only as names; removing the shown-rows line makes the review-4 test fail; macOS/Linux unchanged). WARNING
  FIXED: the collision tests could still skip green on a fresh disk; the helper now recycles a pool first (up to 128
  rounds, 60 s budget) and a missing pair FAILS on Windows instead of skipping. NITs FIXED: the shown-rows exact stat
  only when a fingerprint is asked (changedFileTimes pays nothing); the helper keys on the unsigned id. 21/21 with
  filehash-6761, 0 skipped, three runs. Converged.

### Final Ledger
- [WARNING] the collision tests could skip green on a fresh disk --> FIXED (pool recycling first, up to 128 rounds; a missing pair fails on Windows)
- [NIT] exact stat on shown listFiles rows when no fingerprint is asked --> FIXED (only when fingerprinted)
- [NIT] the test helper keyed on the signed id --> FIXED (unsigned)
- [NIT] the two reads of a gated path agree on the number id only (a colliding swap within microseconds) --> ACCEPTED, in the plan's Weakest part
- [NIT] a swap at download answers "not there any more" rather than "changed" --> ACCEPTED (wording)
