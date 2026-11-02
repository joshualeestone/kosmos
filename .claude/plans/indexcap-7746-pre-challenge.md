---
pre_challenge: true
method: challenge-loop
branch: indexcap-7746
diff_hash: 6618aaf5cee691291d6248f659eb42a37e236b6622c59ac038f7f42496993894
validation: passed
subdir_audit: passed
timestamp: 2026-11-02T04:19:03Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at the 8-round cap Splinter set for review loops (usage, 2026-10-22). Round 8 found 2 WARNINGs, fixed after it in 03a7fbd6 (measuredStop kept off the caller's answer; one more accepted gap in the plan), unreviewed. The suites and the full validation ran on it. The rounds ran while the branch was stacked on topplan-7746 (diff origin/topplan-7746...HEAD); after #7766 merged it was rebased onto main with its own commits unchanged.
**Total findings:** 51 (0 BLOCKERs, 21 WARNINGs, 2 CONVENTIONs, 28 NITs)
**Fixed:** 21 actionable | **Deferred:** 2 (with reasons) | **Asked (awaiting user):** 0

Each round, outside the helper: the backupstate, backuprun, backupsnapshot and personalbackup suites with engine.reachable, fixture-discipline and no-name-refs (302 of 302 at the end), and a red control for every guard added, made by breaking it in place and restoring the file byte for byte.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/backuprun.js:231 - an early stop raised the kept stop to a larger listing --> FIXED: an early stop names no stop
- [WARNING] engine/backuprun.js:231 - the stop never expired and named nothing it was measured under --> FIXED: budget recorded, 28-day hand-on; red controls for both

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 2 of the above
- [WARNING] engine/backuprun.js:221 - a stop dated in the future never expired --> FIXED: counts as expired; red control
- [WARNING] engine/backupsnapshot.js:207 - other folders of the same size were stopped --> FIXED: a folders hash in the stop; red control

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 2 CONVENTIONs, 3 NITs
**Self-generated:** 4 of the above
- [WARNING] engine/backupstate-7746.test.js:289 - the malformed-stop test could not fail --> FIXED: raw file written; each side's check red alone
- [WARNING] engine/backuprun.js:219 - the comment called a wrong stop "one try"; it holds every run up to 28 days --> FIXED: said plainly
- [WARNING] engine/personalbackup.js:489 - an unreadable plan value waited silently --> FIXED: planUnreadable and a panel sentence; red control
- [WARNING] engine/backupsnapshot.js:740 - the early stop ran before the plan's own checks --> FIXED: after them; red control
- [CONVENTION] takeSnapshot and backupstate headers missing the new fields --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 of the above
- [WARNING] engine/backuprun.js:104 - a second pass's failed write dropped the first pass's lost checkpoints --> FIXED (reasoned; stated as untested)
- [WARNING] engine/backupsnapshot.js:743 - the person was not told how long the hold lasts --> FIXED: the sentence says so

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above
- [WARNING] engine/backupsnapshot.js:776 - the early stop blocked the in-week repeat that could fit --> FIXED: only a later week stops early; red control
- [WARNING] engine/backuprun.test.js:125 - a comment claimed the 600000 clamp was tested --> FIXED: says it is not

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 5 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 4 of the above
- [WARNING] engine/backupsnapshot.js:781 - a granted week's second pass was stopped by its first pass's stop, and "later" was merely "different" --> FIXED: only a stop kept before the run is handed on; week order; red controls for both
- [WARNING] engine/backuprun.js:236 - what the 28 days count from --> FIXED: stated
- [WARNING] engine/backuprun.js:236 - a failed later-week attempt keeps the old stop --> DEFERRED: accepted gap, stated in the plan
- [WARNING] engine/backupsnapshot.js:743 - every tooManyPieces caller a measured stop? --> checked, yes; stated
- [WARNING] engine/backuprun.js:230 - checkpointsLost has no reader --> DEFERRED: the panel is the screen's step, stated in the plan

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above
- [WARNING] plan - a malformed plan value backs off to a day, not hourly --> FIXED: plan states the backoff
- [WARNING] engine/backupsnapshot.js:777 - near Monday 00:00 one attempt can be skipped --> FIXED: accepted gap, stated

#### Iteration 8 (final)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] engine/backuprun.js:241 - measuredStop reached the caller's answer --> FIXED after the round (03a7fbd6): stripped like `added`; red control; unreviewed
- [WARNING] engine/backuprun.js:229 - a finishing run whose state write fails keeps the old stop --> FIXED after the round: accepted gap stated; unreviewed

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/backuprun.js:231 | BRANCH | early stop raised the kept stop | FIXED | iteration 1 commit |
| 2 | 1 | WARNING | engine/backuprun.js:231 | BRANCH | stop never expired | FIXED | iteration 1 commit |
| 3 | 2 | WARNING | engine/backuprun.js:221 | SELF | future-dated stop | FIXED | iteration 2 commit |
| 4 | 2 | WARNING | engine/backupsnapshot.js:207 | SELF | folders not in the stop | FIXED | iteration 2 commit |
| 5 | 3 | WARNING | engine/backupstate-7746.test.js:289 | SELF | vacuous test | FIXED | iteration 3 commit |
| 6 | 3 | WARNING | engine/backuprun.js:219 | SELF | wrong-stop cost misstated | FIXED | iteration 3 commit |
| 7 | 3 | WARNING | engine/personalbackup.js:489 | SELF | silent unreadable plan | FIXED | iteration 3 commit |
| 8 | 3 | WARNING | engine/backupsnapshot.js:740 | SELF | early stop before plan checks | FIXED | iteration 3 commit |
| 9 | 3 | CONVENTION | engine/backupsnapshot.js:609 | BRANCH | headers missing fields | FIXED | iteration 3 commit |
| 10 | 4 | WARNING | engine/backuprun.js:104 | SELF | lost checkpoints on second pass | FIXED | iteration 4 commit |
| 11 | 4 | WARNING | engine/backupsnapshot.js:743 | SELF | hold length untold | FIXED | iteration 4 commit |
| 12 | 5 | WARNING | engine/backupsnapshot.js:776 | SELF | in-week repeat blocked | FIXED | iteration 5 commit |
| 13 | 6 | WARNING | engine/backupsnapshot.js:781 | SELF | second pass stopped by its own stop | FIXED | iteration 6 commit |
| 14 | 6 | WARNING | engine/backuprun.js:236 | SELF | failed attempt keeps the stop | DEFERRED | accepted gap, plan |
| 15 | 6 | WARNING | engine/backuprun.js:230 | BRANCH | checkpointsLost unread | DEFERRED | the screen's step, plan |
| 16 | 7 | WARNING | .claude/plans/indexcap-7746.md:20 | SELF | backoff misstated | FIXED | iteration 7 commit |
| 17 | 7 | WARNING | engine/backupsnapshot.js:777 | SELF | Monday skew | FIXED | stated as an accepted gap |
| 18 | 8 | WARNING | engine/backuprun.js:241 | SELF | measuredStop on the answer | FIXED | 03a7fbd6, unreviewed |
| 19 | 8 | WARNING | engine/backuprun.js:229 | SELF | failed final write keeps the stop | FIXED | stated, unreviewed |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- [NIT] engine/backuprun.test.js:140 - the 600000 clamp itself is untested (more than 600000 rows needed)
- [NIT] engine/backuprun.js:152 - the unwritable return carries checkpointsLost but not leftOut
- [NIT] engine/backupsnapshot.js:782 - "move some files out" may not suffice if only the count drops

### Strengths (across all iterations)
- One formula (indexCapFor) for the snapshot's chunk cap and the state's index cap (every iteration)
- The stop is strict on read and write, keyed on files, bytes, budget, folders and week, handed on once per run (iterations 3 to 8)
- A malformed plan value waits and is told, distinct from an absent one (iterations 1 to 8)
