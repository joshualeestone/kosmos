---
pre_challenge: true
method: challenge-loop
branch: reseal-7156
diff_hash: 0af27fb09ff7ead48fd1572d5dcffda6016a89a3b53825ad82cecea75506eb30
validation: passed (Mortals)
subdir_audit: passed
timestamp: 2026-10-25T23:44:18Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (opus and sonnet alternating)
**Converged:** Yes (iteration 4: no BLOCKER or CONVENTION; its one WARNING concluded "Nothing to fix")
**Total findings:** 3 actionable WARNINGs plus NITs
**Fixed:** 3 | **Deferred:** 0 | **Asked (awaiting user):** 0

Validation: full suite on Mortals at 0c82320b46 (hash 0af27fb09ff7), clean: 23950 tests, 23616 pass, 0 fail. 6j skipped on the
clean entry. Mutants (committed first, restored with git checkout): the epoch check removed reds the 7156 test (stores epoch-1
chunks under an epoch-2 snapshot, the card's scenario, reproduced by hand); the String() coercion removed reds it too.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, NITs
**Self-generated:** 0
- [WARNING] engine/backupsnapshot.js:652 — comment and plan said the run re-seals at once; it stops as staleIndex and the NEXT run re-seals --> FIXED (comment, plan; the comment fix was lost to a mutant checkout and restored in iteration 2's commit)
- [NIT] numeric epoch --> no change: backupformat refuses a non-string epoch (plan says so)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, NITs
**Self-generated:** 1 (iteration 1's lost edit)
- [WARNING] engine/backupsnapshot.test.js — the test did not run the recovery --> FIXED (withRun drops the index; the next epoch-2 run stores under /2/; the epoch-1 snapshot still restores)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, NITs
**Self-generated:** 0
- [NIT] chain withRun's index into the next run; cite #5686 c; "fake store" in the plan --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING ("Nothing to fix"), NITs
**Self-generated:** 0
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/backupsnapshot.js:652 | BRANCH | run-vs-next-run wording | FIXED | f6c609d569 |
| 2 | 2 | WARNING | engine/backupsnapshot.test.js | BRANCH | recovery not exercised | FIXED | f6c609d569 |
| 3 | 2 | WARNING | engine/backupsnapshot.js | SELF | round-1 edits lost to a mutant checkout | FIXED | f6c609d569 |

### Strengths
- the check sits in the one loop over every index entry, after keyProblem and before any grant: a stale run spends nothing
- the plan's invariant (a registered key never changes epoch) holds against backupmemberkey and the coordinator
- the test has a real control (same index, same epoch, used) and fails without the check
