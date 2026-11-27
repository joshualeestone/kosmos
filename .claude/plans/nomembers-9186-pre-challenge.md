---
pre_challenge: true
method: challenge-loop
branch: nomembers-9186
diff_hash: 00f4eb4b3c9d34a727dce2abf5f08cf39d7226407f3e4ae046bc562e63b7bc3b
validation: passed
subdir_audit: passed
timestamp: 2026-11-27T06:51:24Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 (4, then a failed final validation sent it back, then 3 more)
**Converged:** Yes
**Total findings:** 30 (3 BLOCKERs incl. the final-validation one, 7 WARNINGs, 0 CONVENTIONs, 20 NITs)
**Fixed:** 3 BLOCKERs + 5 WARNINGs + 6 NITs | **Deferred:** 2 WARNINGs (members, not running agents; with reason) | **Asked:** 0

Final validation: queued full run on 5f0aafb99f (validation-log hash 00f4eb4b3c9d), rebased onto main with the pgrep
fix: type-check, lint-fix, test (31675 tests, 0 fail), build. The first final validation (e7f0902348) FAILED on
fixture-discipline and is in the ledger.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above (no loop commit existed yet)
- [BLOCKER] engine/projectview.js:583 - the member check kept only strings; on the real path (projects.list -> describe -> overviewOf) members are objects, so EVERY staffed project would read as unstaffed --> FIXED (b0a7e937ef): a name or a described member's sessionName counts; real-path test
- [WARNING] tests fed only the raw shape --> FIXED (real-path test through projects.describe)
- [WARNING] #8996's fixture used the raw shape --> FIXED
- [NIT] "still need" singular --> FIXED; [NIT] starter comment --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] no test pinned that a test project is skipped --> FIXED (4d07215928); perturbation red
- [NIT] listGroup and projectPaused comment --> FIXED

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 (the paused sentence's "either", written in iteration 1)
- [BLOCKER] the sentence offered `kosmos task assign ... --add-member`, which the assign route refuses for a non-member, and every reader of the sentence is one --> FIXED (e7e945ac26): points at the person with the board's own words
- [WARNING] the paused "either" leaned on the core line naming the pause (not on the no-date path) --> FIXED: stands alone; test

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] counts members, not running agents --> DEFERRED: the card's definition ("no agent members"), named as the Weakest premise
**Converged.** Final validation (6j) on e7f0902348 FAILED:
- [BLOCKER] final-validation: fixture-discipline.test.js "no test builds an agent card or a roster row by hand" (four sessionName: literals in the iteration-1 fixtures) --> FIXED (26b443913f): members from projects.describe; rebased onto main

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 (the wording, iteration 3)
- [WARNING] "nothing will move its N tasks" claimed more than membership --> FIXED (9ebe2acfed): "No agent is on this project to pick up its N ..."
- [NIT] plural paused test --> FIXED

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING (duplicate of iteration 4's deferral), 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 (a stale test title)
- [NIT] a test title quoted the old words --> FIXED (00e7827727)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | engine/projectview.js:583 | BRANCH | strings-only member check | FIXED | b0a7e937ef |
| 2 | 1 | WARNING | projectview.unstaffed-9186.test.js | BRANCH | raw-shape fixtures | FIXED | b0a7e937ef |
| 3 | 2 | WARNING | projectview.unstaffed-9186.test.js | BRANCH | test project unpinned | FIXED | 4d07215928 |
| 4 | 3 | BLOCKER | engine/projectview.js:778 | BRANCH | refused command offered | FIXED | e7e945ac26 |
| 5 | 3 | WARNING | engine/projectview.js:777 | SELF | dangling "either" | FIXED | e7e945ac26 |
| 6 | 4 | WARNING | engine/projectview.js:584 | BRANCH | members, not running agents | DEFERRED | card's definition |
| 7 | 4 | BLOCKER | final-validation | BRANCH | fixture-discipline | FIXED | 26b443913f |
| 8 | 5 | WARNING | engine/projectview.js:781 | SELF | overclaiming words | FIXED | 9ebe2acfed |

### NITs (non-blocking, across all iterations)
- listed round by round in the plan's Reviews section

### Strengths (across all iterations)
- The count reads both member shapes a real caller sends, and a test goes through projects.describe -> overviewOf -> renderShow
- Every #8996 output is byte-for-byte unchanged (activityCoreLine); an older board sends no count and prints nothing new
- The words point at the one action every reader can take (the person adds a member), and the paused case is told apart
