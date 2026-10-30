---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0771
diff_hash: 100929f0bd00c318761035a8d1a679d9442eaf137362d0493bbd73aa80cbd1f4
validation: failed (contention only; every failing file green alone, see below)
subdir_audit: passed
timestamp: 2026-10-27T11:48:55Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4: its one warning deferred as a non-issue, see below; no new actionable finding)
**Total findings:** 0 BLOCKERs, 4 WARNINGs (3 fixed, 1 deferred), 1 CONVENTION (fixed), NITs recorded
**Fixed:** 4 | **Deferred:** 1 | **Asked (awaiting user):** 0

### Validation, stated as it happened
- Run 1 (06:09): RED for a real reason: the #1720 browser-check gate (a web/ change with no check and no trailer).
  Fixed with the trailer earlier What's New PRs use (`Browser-check: built data file only; whats-new-check passes`),
  fe04700d77; the failing test then 24/24.
- Run 2 (06:25): 1 red, engine/remote.test.js "timed out waiting for the tunnel to come up" at load 7; the file alone
  242/242.
- Run 3 (06:37): 3 reds, all timing (create.test.js 73 s, manipcheck-5683 "linear time", remove.test.js async
  restart) at load 9.6, time-scale 1.61x; each file alone green: 236/0, 85/0, 104/0.
- The diff is two data files (release/whats-new-pool.json, web/whats-new.json) and the plan; no code changed. The PR's
  CI runs the full suite before merge. The What's New tests (whats-new-check-3955, pool-5711, pool-sync-5713,
  release-gate) are 104/104, and whats-new-check 0.7.71 passes (5 highlights, mac 5, windows 5).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 0
- [WARNING] release/whats-new-pool.json:842 - damaged-file line promised a copy always --> FIXED (e087fe16a5)
- [WARNING] web/whats-new.json:3 - three 0.7.70 items drop out of the window --> FIXED (decision stated in the plan)
- NITs fixed: plainer links, tables, community and damaged-file words

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1
- [WARNING] release/whats-new-pool.json:860 - "long names and codes in it wrap" overstated #7236 --> FIXED by deleting the clause (9ba3b4418a)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 4 NITs
**Self-generated:** 1
- [WARNING] release/whats-new-pool.json:842 - "when it has a good copy, offers to put it back" still promised a button #7255 does not always show --> FIXED by deleting the copy claim (1f97c830bb)
- [CONVENTION] plan - the other user-facing merges left out were not named --> FIXED (each with its reason)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING (deferred), 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [WARNING] release/whats-new-pool.json:843 - the line does not mention the Put back button --> DEFERRED: the reviewer calls it "a mild surprise rather than a falsehood" and optional; naming the button brings back the conditional claim iterations 1 and 3 found wrong, so the line says only what is always true.
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | release/whats-new-pool.json:842 | BRANCH | copy always promised | FIXED | e087fe16a5 |
| 2 | 1 | WARNING | web/whats-new.json:3 | BRANCH | 0.7.70 items drop out | FIXED | plan decision |
| 3 | 2 | WARNING | release/whats-new-pool.json:860 | SELF | wrap clause overstated | FIXED | 9ba3b4418a |
| 4 | 3 | WARNING | release/whats-new-pool.json:842 | SELF | conditional copy still promised | FIXED | 1f97c830bb |
| 5 | 3 | CONVENTION | plan | BRANCH | left-out merges unnamed | FIXED | 1f97c830bb |
| 6 | 4 | WARNING | release/whats-new-pool.json:843 | BRANCH | button not mentioned | DEFERRED | always-true wording |

### NITs (non-blocking, across all iterations)
- .ai/.dev bare addresses stay plain; a wide table still scrolls inside the bubble; rank 11 shares a number with a shown
  item; the community item (rank 12.6, not in the window) must become one sentence and drop the every-agent link
  before it can be chosen.

### Strengths (across all iterations)
- web/whats-new.json is exactly what the pool build produces (checked independently by three reviewers).
- Every new item cites a merged PR that landed after the 0.7.70 freeze; no em dashes; within the length limits.
