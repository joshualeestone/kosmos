---
pre_challenge: true
method: challenge-loop
branch: topplan-7746
diff_hash: 1c41cca48cb76fcc8ad161ead8bfe3e60e57f9729e3de66898f6faf77d94e9b2
validation: passed
subdir_audit: passed
timestamp: 2026-11-02T02:17:24Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at the 8-round cap Splinter set for review loops (usage, 2026-10-22), not by convergence. Round 8 found 3 WARNINGs. All three were fixed after it, in one commit (a one-line forget on a failed write, and two header sentences). No reviewer saw that commit; the suites and the full validation ran on it.
**Total findings:** 46 (0 BLOCKERs, 20 WARNINGs, 2 CONVENTIONs, 24 NITs)
**Fixed:** 22 actionable | **Deferred:** 0 | **Asked (awaiting user):** 0

Each round, outside the validation helper: the backupstate (5535 and 7746), backuprun, backupsnapshot and personalbackupjob suites, plus engine.reachable, fixture-discipline and no-name-refs (219 of 219 at the end). Every guard added has a red control, measured by breaking it in place and restoring the file byte for byte: the queue, the late cleanup, the inode, the ctime, the paused-read guard, a refused read forgetting the fingerprint, discardState during a write, the checkpoint await, a bad id rejecting, the fingerprint skip, the turns. Two controls stayed green and their assertions were removed as unable to fail (discardState forgetting, and the loose-file rule on macOS; both redundant because the ctime moves).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 1 of the above (the vacuous read-fingerprint assertion, in a test this loop's branch wrote)
- [WARNING] engine/backupstate-7746.test.js:70 - the "after our own read" assertion could not fail --> FIXED (11ece007), red control measured
- [WARNING] engine/backupsnapshot.js:835 - the checkpoint await untested --> FIXED (11ece007): test red without it
- [WARNING] plan:9 - stall figures understated a loaded machine --> FIXED (11ece007)
- [CONVENTION] engine/backupstate.js:29 - header stale --> FIXED (11ece007)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 of the above
- [WARNING] engine/backupstate.js:174 - a not-ours read and discardState did not forget the fingerprint --> FIXED (branch commit after 11ece007)
- [WARNING] engine/backupstate.js:206 - async writes could interleave --> FIXED: per-file queue, a sync write in flight throws; test red without the queue
- [WARNING] engine/backupstate-7746.test.js:60 - no inode-only swap test --> FIXED: rename swap with size and mtime to the ns; red without dev and inode

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 2 of the above
- [WARNING] engine/backupstate.js:395 - writeStateAsync threw synchronously on a bad id --> FIXED: rejects; test red without
- [WARNING] engine/backupstate-5535.test.js:146 - a held file on the skip path untested --> FIXED: rename refuses with retry, file unchanged
- [CONVENTION] engine/backupstate.js:181 - the in-progress throw undocumented --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 of the above
- [WARNING] engine/backupstate.js:249 - the in-flight entry was cleared two ticks late, so a sync write right after an await threw (reviewer reproduced it) --> FIXED: cleared in the chain; test red with the old cleanup
- [WARNING] engine/backupstate.js:186 - a paused read could overwrite a newer fingerprint --> FIXED: knownAtStart guard; test red without

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 of the above
- [WARNING] engine/backupstate.js:179 - no ctime in the fingerprint --> FIXED: ctime added, chmod only a loose file; in-place rewrite test red without ctime

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 3 of the above
- [WARNING] engine/backupstate.js:209 - on Windows every file read as loose, so the skip never fired --> FIXED (refined in iteration 7)
- [WARNING] engine/backupstate.js:42 - header omitted ctime --> FIXED
- [WARNING] engine/backupstate-7746.test.js - new forget branches untested --> FIXED where observable (refused read over an unchanged file, red without); the unobservable ones stated as such in the plan

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] engine/backupstate.js:212 - on Windows a read-only state file would no longer repair itself, and every rename after it would fail --> FIXED: on Windows a read-only file is loose and chmodded
- [WARNING] engine/backupstate.js:345 - discardState not serialised against an async write --> FIXED: refuses while in flight; test red without

#### Iteration 8 (final, whole branch)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] engine/backupstate.js:~280 - a write that throws after its rename left the old fingerprint --> FIXED after the round (ff1df8bd15), unreviewed
- [WARNING] engine/backupstate.js:~238 - the caller must not change the index Maps during a write --> FIXED after the round: stated in the header, unreviewed
- [WARNING] engine/backupstate.js:writeState - a future sync caller on the run path would get a code-less throw --> FIXED after the round: stated in the header, unreviewed

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/backupstate-7746.test.js:70 | SELF | vacuous assertion | FIXED | 11ece007 |
| 2 | 1 | WARNING | engine/backupsnapshot.js:835 | BRANCH | checkpoint await untested | FIXED | 11ece007 |
| 3 | 1 | WARNING | .claude/plans/topplan-7746.md:9 | SELF | stall understated | FIXED | 11ece007 |
| 4 | 1 | CONVENTION | engine/backupstate.js:29 | BRANCH | header stale | FIXED | 11ece007 |
| 5 | 2 | WARNING | engine/backupstate.js:174 | SELF | fingerprint not forgotten | FIXED | iteration 2 commit |
| 6 | 2 | WARNING | engine/backupstate.js:206 | SELF | writes could interleave | FIXED | iteration 2 commit |
| 7 | 2 | WARNING | engine/backupstate-7746.test.js:60 | BRANCH | no inode-only test | FIXED | iteration 2 commit |
| 8 | 3 | WARNING | engine/backupstate.js:395 | SELF | sync throw on bad id | FIXED | iteration 3 commit |
| 9 | 3 | WARNING | engine/backupstate-5535.test.js:146 | BRANCH | held file on skip path | FIXED | iteration 3 commit |
| 10 | 3 | CONVENTION | engine/backupstate.js:181 | SELF | in-progress throw undocumented | FIXED | iteration 3 commit |
| 11 | 4 | WARNING | engine/backupstate.js:249 | SELF | late cleanup | FIXED | iteration 4 commit |
| 12 | 4 | WARNING | engine/backupstate.js:186 | SELF | paused read overwrote fingerprint | FIXED | iteration 4 commit |
| 13 | 5 | WARNING | engine/backupstate.js:179 | SELF | no ctime | FIXED | iteration 5 commit |
| 14 | 6 | WARNING | engine/backupstate.js:209 | SELF | Windows skip never fired | FIXED | iterations 6 and 7 |
| 15 | 6 | WARNING | engine/backupstate.js:42 | SELF | header omitted ctime | FIXED | iteration 6 commit |
| 16 | 6 | WARNING | engine/backupstate-7746.test.js | SELF | forget branches untested | FIXED | iteration 6 commit |
| 17 | 7 | WARNING | engine/backupstate.js:212 | SELF | Windows read-only regression | FIXED | iteration 7 commit |
| 18 | 7 | WARNING | engine/backupstate.js:345 | BRANCH | discardState during a write | FIXED | iteration 7 commit |
| 19 | 8 | WARNING | engine/backupstate.js:~280 | SELF | fingerprint after a failed write | FIXED | after round 8, unreviewed |
| 20 | 8 | WARNING | engine/backupstate.js:~238 | SELF | caller duty unstated | FIXED | after round 8, unreviewed |
| 21 | 8 | WARNING | engine/backupstate.js:writeState | SELF | sync caller on run path | FIXED | after round 8, unreviewed |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- [NIT] engine/backupstate-7746.test.js:82 - the turn-count threshold depends on ROWS_PER_PAUSE without importing it (iteration 8)
- [NIT] engine/backupstate.js - knownAtStart captured in two places; both correct (iteration 8)
- [NIT] engine/backupstate.js - long header lines (iterations 2, 4, 8)
- [NIT] engine/backupstate.js:157 - the paused guard on a refused read is not separately tested (iteration 7)

### Strengths (across all iterations)
- One generator per function, run straight through by the sync versions, so sync and async cannot drift; a test compares them (every iteration)
- The fingerprint skip fails toward a full read on any doubt (every iteration)
- The write queue: no poisoned chain, no leak, no unhandled rejection, cleared before the caller resumes (iterations 3 to 8)
- Every new guard has a test measured red without it (iterations 5 to 8)
