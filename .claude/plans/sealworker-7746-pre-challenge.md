---
pre_challenge: true
method: challenge-loop
branch: sealworker-7746
diff_hash: 658537cb10113474579213c5dff7c04b48ad4feb9e86491f0b3ac3205677f0e7
validation: passed
subdir_audit: passed
timestamp: 2026-11-02T05:48:21Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at the 8-round cap Splinter set for review loops (usage, 2026-10-22). Round 8 found 2 WARNINGs and 4 NITs; the fixes after it are in d7450682 (worker answer shapes documented, a parse failure in the worker falls back, the report hook guarded, the timer unref'd) and are unreviewed. Rounds 1 to 5 ran while the branch was stacked on indexcap-7746 (diff origin/indexcap-7746...HEAD); after #7770 merged it was rebased onto main with its own commits unchanged, and rounds 6 to 8 reviewed origin/main...HEAD.
**Total findings:** 49 (0 BLOCKERs, 20 WARNINGs, 2 CONVENTIONs, 27 NITs)
**Fixed:** 19 actionable | **Deferred:** 1 (decided, measured) | **Asked (awaiting user):** 0

Each round: backupstate, backuprun, backupsnapshot, personalbackup and backupformat suites with engine.reachable, fixture-discipline, no-name-refs and install.reachable (367 of 367 at the end), and a red control for every guard added, made by breaking it in place and restoring the file byte for byte.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/backupsnapshot.test.js:1899 - the test passed with a broken worker (the fallback covered it) --> FIXED: the report hook checks which path sealed; red with a broken worker
- [WARNING] engine/backupsnapshot.js:982 - no timeout on a silent worker --> FIXED: 10-minute wait, then sealed here
- [WARNING] engine/backupsnapshot.js:993 - the fallback was silent --> FIXED: sealedInProcess on the run's answer
- [WARNING] engine/backupsnapshot.js:983 - the JSON string held during a fallback --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 of the above
- [WARNING] engine/backupsnapshot.js:1008 - messageerror would wait the full timeout --> FIXED: falls back at once
- [WARNING] engine/backupsnapshot.js:1011 - a worker started for a manifest that could not be sent, with no reason given --> FIXED: stringified first; reason codes

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 5 NITs
**Self-generated:** 3 of the above
- [WARNING] engine/backupsnapshot.js:947 - JSON.stringify quietly rewrote values the seal refuses (undefined, -0, NaN, a Date) --> FIXED: the refusing replacer, measured at 60 to 150 ms extra; red control
- [WARNING] engine/backupsnapshot.test.js:1925 - the exit listener untested --> FIXED: a worker that exits on its message; red control
- [WARNING] engine/backupsnapshot.test.js:1917 - termination not asserted --> FIXED (finished in iteration 4)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 3 of the above
- [WARNING] engine/backupsnapshot.test.js:1912 - an exit listener attached too late (a flake seen once) --> FIXED: watched from onWorker
- [WARNING] engine/backupsnapshot.js:1005 - the toJSON gap undocumented --> FIXED in iteration 5
- [WARNING] engine/backupsnapshot.js:1043 - a member key that is not bytes --> FIXED: refused before any hand-off

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 3 of the above
- [WARNING] engine/backupsnapshot.js:997 - an own toJSON slipped past the replacer --> FIXED: any object with a callable toJSON is refused; red control
- [WARNING] engine/backupsnapshot.test.js:1915 - "the answered worker was ended" could not fail --> FIXED: a test worker kept alive after answering; red control

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above
- [WARNING] engine/backupsnapshot.js - a worker failure that is not a refusal reported 'worker' and sealed here silently --> FIXED: goes through the fallback with worker-ended; red control

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 3 of the above
- [WARNING] engine/backupsnapshot.js:1000 - the rules the replacer does not mirror --> DEFERRED: measured; an ownKeys check costs 376 to 547 ms (stall about 600 ms instead of 230); stated in the comment, the test and the plan
- [WARNING] engine/backupsnapshot.js:1030 - the string held on two fallback paths --> FIXED: released inside the fallback
- [WARNING] engine/backupsnapshot.js:977 - sealedInProcess untested through takeSnapshot --> FIXED: red control
- [WARNING] engine/backupseal-worker.js:17 - worker memory unmeasured --> FIXED in iteration 8: measured

#### Iteration 8 (final)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above
- [WARNING] engine/backupsnapshot.js:998 - the replacer gap again (measured by the reviewer) --> DEFERRED as above; the test comment no longer claims it
- [WARNING] engine/backupsnapshot.js:1013 - peak memory --> measured after the round: in-process +1.28 GiB, worker path +1.05 GiB

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/backupsnapshot.test.js:1899 | BRANCH | broken worker hidden by the fallback | FIXED | iteration 1 |
| 2 | 1 | WARNING | engine/backupsnapshot.js:982 | BRANCH | no timeout | FIXED | iteration 1 |
| 3 | 1 | WARNING | engine/backupsnapshot.js:993 | BRANCH | silent fallback | FIXED | iteration 1 |
| 4 | 2 | WARNING | engine/backupsnapshot.js:1008 | SELF | messageerror waits | FIXED | iteration 2 |
| 5 | 3 | WARNING | engine/backupsnapshot.js:947 | BRANCH | values rewritten, not refused | FIXED | iteration 3 |
| 6 | 3 | WARNING | engine/backupsnapshot.test.js:1925 | SELF | exit listener untested | FIXED | iteration 3 |
| 7 | 4 | WARNING | engine/backupsnapshot.test.js:1912 | SELF | late exit listener (flake) | FIXED | iteration 4 |
| 8 | 4 | WARNING | engine/backupsnapshot.js:1043 | SELF | member key not bytes | FIXED | iteration 4 |
| 9 | 5 | WARNING | engine/backupsnapshot.js:997 | SELF | own toJSON | FIXED | iteration 5 |
| 10 | 5 | WARNING | engine/backupsnapshot.test.js:1915 | SELF | vacuous termination check | FIXED | iteration 5 |
| 11 | 6 | WARNING | engine/backupsnapshot.js | SELF | silent non-refusal fallback | FIXED | iteration 6 |
| 12 | 7 | WARNING | engine/backupsnapshot.js:1000 | SELF | replacer does not mirror three rules | DEFERRED | measured cost; stated |
| 13 | 7 | WARNING | engine/backupsnapshot.js:977 | SELF | sealedInProcess untested | FIXED | iteration 7 |
| 14 | 8 | WARNING | engine/backupsnapshot.js:1013 | SELF | memory unmeasured | FIXED | measured, d7450682 |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- [NIT] engine/backupsnapshot.js - the messageerror listener and the settled guard have no test of their own (stated in the plan)
- [NIT] engine/backupsnapshot.js - a ctx with prototype fields would be refused by the worker (snapshotInner's is plain; stated)

### Strengths (across all iterations)
- The worker seals with the same sealManifest; every failure falls back here, so a worker problem never means no seal (every iteration)
- Settles exactly once; the worker is ended on every path; termination tested directly (iterations 5 to 8)
- The main-thread stall at the top plan goes from a 1.6 to 1.8 s block to about 230 ms (every iteration)
