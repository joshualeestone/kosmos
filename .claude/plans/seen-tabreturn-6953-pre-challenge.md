---
pre_challenge: true
method: challenge-loop
branch: seen-tabreturn-6953
diff_hash: 216ee6003caaee77d9aff2fd050664be73a4c9456f8031ea4292ebbcf67ce96c
validation: passed (focused: 413 files, 3295 tests, REAL_EXIT=0, at 3535e448 before the replay onto main; after the replay, the card's 5 test files plus main's new web.reviewernotice-6752 70/70, and both browser-check gates with per-check surface trailers; the full suite is CI's)
subdir_audit: passed (no CLAUDE.md changed)
timestamp: 2026-10-23T03:35:26Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 (round 7 raised NITs only, all fixed in 1a7fb502)
**Converged:** Yes
**Total findings:** 37 (0 BLOCKERs, 11 WARNINGs, 1 CONVENTION, 25 NITs)
**Fixed:** 11 warnings | **Deferred:** 0 | **Asked (awaiting user):** 0
**Source:** the reviewers' reports are in the session transcript 7bbab1fa (the commit bodies carry no ledger); shas below are after the replay onto main.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
- [WARNING] web/index.html - clearing tkMarked on every return re-asked a board that refused or failed twice, against the #6951 "settled" rule --> FIXED (cd9717c0): tkRecorded; a return re-records only a state the board answered 2xx for, with a 403/500 test

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] web/index.html - tkRecorded was written outside the newer-state guard, so an older state settling late stopped re-records --> FIXED (6f42c9c3): same guard as tkMarked, out-of-order test
- [WARNING] web.task-seen-6947.test.js - no tests for a return during an in-flight record, after a change, after a failed read --> FIXED (6f42c9c3)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
- [WARNING] web/index.html - a tab also turns visible when a covering window closes or the screen wakes, with nobody looking --> FIXED (3ae783d3): re-record only with the window focused, test with a focused control

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
- [WARNING] web/index.html - hasFocus read once at visibilitychange misses a return from another app, where focus settles later --> FIXED (5673a146): window focus listener runs the same return

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] a tab switch ran the return twice (two full reads and redraws) --> FIXED (f9c0d7c9): onlyIfChanged on the return
- [WARNING] an app switch made a full announced redraw, losing selection and focus --> FIXED (f9c0d7c9)
- [WARNING] one return could record twice --> FIXED (f9c0d7c9): tkReturnAt two-second window
- [WARNING] the visibility/focus pair was pinned only by regex --> FIXED (f9c0d7c9): driven tab-switch test

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 3 NITs
- [WARNING] a changed conversation on a return was drawn quiet, so a screen reader no longer heard it (AA) --> FIXED (e80a73b4): quiet applies only to the five-second read, live-region test
- [WARNING] no test that a return after a change redraws --> FIXED (e80a73b4)
- [CONVENTION] plan filename has no timestamp --> NO CHANGE: matches the proof naming the gate needs

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
- [NIT] focus comment, dead visibilitychange stub, a return restoring focus untested, address bar not named --> FIXED (1a7fb502)
**Converged** - no blocker or warning.

### Final Ledger (warnings and above)

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html | BRANCH | refusing board re-asked | FIXED | cd9717c0 |
| 2 | 2 | WARNING | web/index.html | SELF | tkRecorded outside guard | FIXED | 6f42c9c3 |
| 3 | 2 | WARNING | web.task-seen-6947.test.js | BRANCH | untested return paths | FIXED | 6f42c9c3 |
| 4 | 3 | WARNING | web/index.html | BRANCH | visible without a look | FIXED | 3ae783d3 |
| 5 | 4 | WARNING | web/index.html | SELF | focus settles late | FIXED | 5673a146 |
| 6 | 5 | WARNING | web/index.html | SELF | double return | FIXED | f9c0d7c9 |
| 7 | 5 | WARNING | web/index.html | SELF | app switch full redraw | FIXED | f9c0d7c9 |
| 8 | 5 | WARNING | web/index.html | SELF | one return records twice | FIXED | f9c0d7c9 |
| 9 | 5 | WARNING | web.task-seen-6947.test.js | SELF | regex-only wiring | FIXED | f9c0d7c9 |
| 10 | 6 | WARNING | web/index.html | SELF | return not announced | FIXED | e80a73b4 |
| 11 | 6 | WARNING | web.task-seen-6947.test.js | SELF | changed redraw untested | FIXED | e80a73b4 |
| 12 | 6 | CONVENTION | .claude/plans | BRANCH | plan filename | NO CHANGE | gate naming |

### Strengths
- The poll gate is a function the test runs, with an all-true control and one arm per false condition (iterations 1-7)
- tkRecorded moves with tkMarked under one guard, so a refusing or broken board stays settled and a late older state cannot block a re-record (iterations 2-7)
- Every caller of paintTaskActivity passes the right flags: only the five-second read is quiet; open and action redraws are full and announced (iteration 7)
