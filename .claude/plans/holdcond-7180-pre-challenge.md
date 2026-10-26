---
pre_challenge: true
method: challenge-loop
branch: holdcond-7180
diff_hash: a0f4e025ca4359f8df204326250fffc4017fe65ffd5f77d62385d4a0006797d5
validation: passed
subdir_audit: passed
timestamp: 2026-10-26T10:15:47Z
iterations: 9
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 9
**Converged:** Yes (iteration 9: zero NEW findings after deduplication, no ASKED findings)
**Total findings:** 27 actionable (2 BLOCKERs, 22 WARNINGs, 3 CONVENTIONs), plus NITs
**Fixed:** 19 | **Deferred:** 8 | **Asked (awaiting user):** 0

Reviewer models alternated: opus on odd iterations, sonnet on even ones.
Self-generated (6c-bis Origin): not computed by blame in this run. One prose claim this loop had written (the
instructions' "(that has happened)", iteration 5) was found stale-able in iteration 7 and deleted, not reworded.
Validation note: the iteration 1 validation ran while iteration 2's edits were committed under it, so its verdict was
discarded. The final validation is a fresh run on the final code head 9bc2665132: clean.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
- [BLOCKER] engine/tasks.js:1114 — a changed condition counted as a new hold and dropped onHoldByPerson, so an agent could strip the person's mark then lift the hold --> FIXED (403 on an agent's change; mark dropped only when held state flips; route test both arms)
- [WARNING] server.js:23443 — no route test with until --> FIXED (server.test.js #7180)
- [WARNING] engine/tasks.js:432 — time zones ambiguous --> FIXED (time of day needs Z or offset; CLIs echo stored time)
- [WARNING] install/kosmos:5835 — wrong message for three-word shapes --> FIXED (needs a value / no more words / one condition)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] engine/holdstale.js:78 — unmet parks with no ceiling; cycles --> FIXED (cycle refused) / DEFERRED (no ceiling is the card's intent, stated in the plan)
- [WARNING] engine/tasks.js:1058 — lenient Date.parse forms --> FIXED (strict ISO shape)
- [WARNING] engine/tasks.js:1117 — a met condition ignored is never told again --> FIXED (own holdMetTold mark)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
- [BLOCKER] engine/holdstale.js:203 — the sweep's book key lacked the reason, so a delivered met line blocked every later posts line --> FIXED (reason in the key; sweep test with one shared book)
- [WARNING] engine/tasks.js:1069 — impossible dates rolled over --> FIXED (real-date check)
- [WARNING] engine/tasks.js:1132 — agent bare re-hold of a conditioned person's hold refused --> FIXED (kept whole)
- [WARNING] engine/tasks.js:1140 — screen re-hold drops an agent's condition --> DEFERRED (by design; documented and tested)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs (1 duplicate), 1 CONVENTION, 3 NITs
- [WARNING] engine/tasks.js:1156 — no test of an agent repeating the person's condition --> FIXED
- [WARNING] engine/holdstale.js:83 — a hold with no history row is never told --> DEFERRED (the posts rule skips it the same way; plan)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 4 NITs
- [WARNING] engine/tasks.js:1139 — restating a met condition refused --> FIXED (restating is no change)
- [WARNING] engine/projects.js:3689 — person's hold dropped its condition in the instructions --> FIXED
- [WARNING] engine/holdstale.js:86 — met line's age counts from the last condition change --> FIXED (wording "set N ago") / posts-rule reset DEFERRED (as unhold then hold)
- [CONVENTION] CLAUDE.md:105 — the row did not name the new fields --> FIXED

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs (1 duplicate), 1 CONVENTION, 3 NITs
- [WARNING] list rows do not show a met condition; an ownerless held task is not told --> DEFERRED (plan)
- [WARNING] CLIs refused lowercase t/z the board takes --> FIXED

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING (1 duplicate), 0 CONVENTIONs, 3 NITs
- [WARNING] engine/projects.js:3693 — "(that has happened)" is a snapshot that goes stale --> FIXED (claim deleted)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs (1 duplicate), 1 CONVENTION, 3 NITs
- [WARNING] engine/tasks.js:1150 — a bare re-hold that drops a condition left no trace --> FIXED (untilCleared, phrased in activity)
- [WARNING] engine/tasks.js:1141 — the restate check was duplicated --> FIXED (one check)

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 (1 duplicate: the screen hold replacing an agent's condition, iteration 3), 4 NITs
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | engine/tasks.js:1114 | BRANCH | condition change strips the person's mark | FIXED | iter 1 |
| 2 | 1 | WARNING | server.js:23443 | BRANCH | no route test | FIXED | iter 1 |
| 3 | 1 | WARNING | engine/tasks.js:432 | BRANCH | zones ambiguous | FIXED | iter 1 |
| 4 | 1 | WARNING | install/kosmos:5835 | BRANCH | argument messages | FIXED | iter 1 |
| 5 | 2 | WARNING | engine/holdstale.js:78 | BRANCH | cycles / no ceiling | FIXED / DEFERRED | iter 2, plan |
| 6 | 2 | WARNING | engine/tasks.js:1058 | BRANCH | lenient times | FIXED | iter 2 |
| 7 | 2 | WARNING | engine/tasks.js:1117 | BRANCH | met then silence | FIXED | iter 2 |
| 8 | 3 | BLOCKER | engine/holdstale.js:203 | BRANCH | book key lacks reason | FIXED | iter 3 |
| 9 | 3 | WARNING | engine/tasks.js:1069 | BRANCH | rolled-over dates | FIXED | iter 3 |
| 10 | 3 | WARNING | engine/tasks.js:1132 | BRANCH | bare re-hold refused | FIXED | iter 3 |
| 11 | 3 | WARNING | engine/tasks.js:1140 | BRANCH | screen re-hold drops condition | DEFERRED | by design, tested |
| 12 | 4 | WARNING | engine/tasks.js:1156 | BRANCH | same-condition test | FIXED | iter 4 |
| 13 | 4 | WARNING | engine/holdstale.js:83 | BRANCH | no history row | DEFERRED | as posts rule |
| 14 | 5 | WARNING | engine/tasks.js:1139 | BRANCH | restate refused | FIXED | iter 5 |
| 15 | 5 | WARNING | engine/projects.js:3689 | BRANCH | person's condition hidden | FIXED | iter 5 |
| 16 | 5 | WARNING | engine/holdstale.js:86 | BRANCH | age wording / reset | FIXED / DEFERRED | iter 5, plan |
| 17 | 5 | CONVENTION | CLAUDE.md:105 | BRANCH | row lacks fields | FIXED | iter 5 |
| 18 | 6 | WARNING | list rows | BRANCH | met not shown; ownerless | DEFERRED | plan |
| 19 | 6 | WARNING | install/kosmos | BRANCH | lowercase refused | FIXED | iter 6 |
| 20 | 7 | WARNING | engine/projects.js:3693 | SELF | stale "(that has happened)" | FIXED | deleted |
| 21 | 8 | WARNING | engine/tasks.js:1150 | BRANCH | silent condition drop | FIXED | iter 8 |
| 22 | 8 | WARNING | engine/tasks.js:1141 | SELF | duplicated restate check | FIXED | iter 8 |

### Outstanding questions
None.

### NITs (non-blocking, across all iterations)
- metText's "is closed" for a deleted task (iteration 9); counted as met, wording kept.
- metText and tellText each build idOf (iteration 5, 9).
- A non-ISO restatement of the stored instant is a 200 no-op (iterations 6, 7, 9).
- --until-task confirmation echoes the typed number (iteration 9); the board stores it as sent.

### Strengths (across all iterations)
- Strict, tested condition validation (one key, self, missing, closed, cycles, ISO, real dates, zones, past, a year).
- The person's hold is protected in both directions, with route tests and controls.
- Met and posts lines are separate in mark, group and book key; a sweep test drives both through one book.
