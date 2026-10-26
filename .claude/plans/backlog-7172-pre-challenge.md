---
pre_challenge: true
method: challenge-loop
branch: backlog-7172
diff_hash: 52e5daef2022c6c89fe6a3aa9e4948029d7c8eefd84842a06684ec9acfa18c3f
validation: passed
subdir_audit: passed
timestamp: 2026-10-26T08:41:36Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10
**Converged:** Yes (iteration 10: zero NEW findings after deduplication, no ASKED findings)
**Total findings:** 26 actionable (0 BLOCKERs, 22 WARNINGs, 4 CONVENTIONs), plus NITs
**Fixed:** 16 | **Deferred:** 4 | **Duplicates of ledger entries:** 9 | **Asked (awaiting user):** 0

Reviewer models alternated: opus on odd iterations, sonnet on even ones.
Self-generated (6c-bis Origin): not computed by blame in this run. Every finding was handled by the ordinary fix
path. The prose findings on comments this loop had written (iterations 5, 7 and 9) were fixed by cutting the claim back to
what a test checks, not by adding a more careful sentence.
Rebased once, after iteration 6, onto #7175 (03dfea5a5f). The loop's earlier commit ids changed then.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 2 CONVENTIONs, 3 NITs
- [WARNING] engine/communityfollow.js:318 — the guarantee was stated in posts, but depth is counted in items (a reply sinks a post) --> FIXED (restated in items, comment and plan)
- [WARNING] engine/communityfollow.test.js:737 — the moving-feed test had no replies --> FIXED (1 post + 2 replies: 0 lost; control 2 + 2: loss)
- [CONVENTION] engine/communityfollow.js:250 — the F7c block kept the old paging condition and annotated over it --> FIXED (rewritten)
- [CONVENTION] engine/communityfollow.js:21 — the header summary lacked the deepest-first rule --> FIXED
- Validation (6g): shard 2 red on tools/test-queued-heavy-4977.sh (contention; 142 OK alone) --> resolved, Origin BRANCH

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 4 NITs
- [WARNING] communityfollow.js:261 — COUNTED_MS restated home's DAY_MS --> FIXED (home's value, later countedFollowing)
- [WARNING] communityfollow.js:289 — the guarantee needs every page; "a failed page costs only its posts" understated it --> FIXED (claim deleted, limit stated in the plan)
- [WARNING] communityfollow.js:317 — no direct test of deepest-first --> FIXED (test: [3,4,5], [1,2,6], [1,2,7])
- [WARNING] communityfollow.js:261 — up to two more requests on every read; the bucket is unmeasured --> DEFERRED: reads with an all-shown newest page already made 3 requests; the bucket size cannot be measured from here
- [CONVENTION] .claude/plans — no timestamp in the plan name --> DEFERRED: repo practice (about 2550 of 3088 plans carry none)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] communityfollow.js:319 — a non-UUID post is never marked seen and would hold the deepest counted place --> FIXED (counted needs a recordable id; test)
- [WARNING] communityfollow.js:293 — busy reads truncate exactly the protected tail --> FIXED (stated in the plan)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs
- [WARNING] communityfollow.js:318 — DAY_MS was read after doneFollowing could throw --> FIXED (read first)
- [WARNING] communityhome.js:181 — home counted non-UUID posts --> DEFERRED to #7175 (countedFollowing), which then took the UUID rule and merged
- [CONVENTION] plan status boxes unchecked --> DEFERRED: expected before the PR

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] communityhome.js:191 — home's titles named the newest posts, while the read takes the deepest --> FIXED (titled as the read picks; test)
- [WARNING] communityfollow.js:317 — a non-UUID post could hold a place in the unseen tier --> FIXED (never unseen)
- [WARNING] communityfollow.js:293 — no test of a failing page --> DEFERRED, then done in iteration 9

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING (2 duplicates), 0 CONVENTIONs, 2 NITs
- [WARNING] communityfollow.js:268 — posts with no id shared one dedup key --> FIXED (only real ids are keys)
- Duplicates: home non-UUID (iteration 4), bucket cost (iteration 2)
- Then rebased onto #7175; the read's "counted" became communityhome.countedFollowing (mutation: red without it)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING (1 duplicate), 0 CONVENTIONs, 3 NITs
- [WARNING] communityhome.js:207 — the comment claimed titles follow the read's ORDER; the read sorts by time and the test checks the set --> FIXED (claim cut to "the posts the next read takes")
- Duplicate: bucket cost (iteration 2)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING (1 duplicate), 1 CONVENTION, 3 NITs
- [WARNING] communityfollow.js:323 — every read is up to 3 posts longer --> DEFERRED: the maximum is unchanged (main also added up to POSTS_WANTED from behind); only how often it is reached changed, stated in the plan's cost
- Duplicate: bucket cost (iteration 2)

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING (1 duplicate), 0 CONVENTIONs, 4 NITs
- [WARNING] communityfollow.js:289 — home without countedFollowing would throw a TypeError --> FIXED (typeof guard; test red without it)
- Duplicate: failing page (iteration 5); the test was written anyway: [21,22], then [23,24,25] once the page answers

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 (2 duplicates: bucket cost, iteration 2; every-page condition, iterations 2 and 9), 3 NITs
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | communityfollow.js:318 | BRANCH | guarantee in posts, depth in items | FIXED | iter 1 commit |
| 2 | 1 | WARNING | communityfollow.test.js:737 | BRANCH | no replies in moving feed | FIXED | iter 1 commit |
| 3 | 1 | CONVENTION | communityfollow.js:250 | BRANCH | F7c block annotated, not rewritten | FIXED | iter 1 commit |
| 4 | 1 | CONVENTION | communityfollow.js:21 | BRANCH | header lacks deepest-first | FIXED | iter 1 commit |
| 5 | 1 | BLOCKER | initial-validation | BRANCH | 6g shard 2 red, contention | FIXED | green alone, later runs clean |
| 6 | 2 | WARNING | communityfollow.js:261 | BRANCH | COUNTED_MS copy | FIXED | iter 2, then #7175 |
| 7 | 2 | WARNING | communityfollow.js:289 | BRANCH | failed page understated | FIXED | iter 2 |
| 8 | 2 | WARNING | communityfollow.js:317 | BRANCH | no direct deepest-first test | FIXED | iter 2 |
| 9 | 2 | WARNING | communityfollow.js:261 | BRANCH | bucket cost unmeasured | DEFERRED | usual state already 3 requests |
| 10 | 2 | CONVENTION | .claude/plans | BRANCH | plan name timestamp | DEFERRED | repo practice |
| 11 | 3 | WARNING | communityfollow.js:319 | BRANCH | non-UUID sticky counted | FIXED | iter 3 |
| 12 | 3 | WARNING | communityfollow.js:293 | BRANCH | busy truncation | FIXED | plan |
| 13 | 4 | WARNING | communityfollow.js:318 | BRANCH | DAY_MS after throw | FIXED | iter 4 |
| 14 | 4 | WARNING | communityhome.js:181 | BRANCH | home counts non-UUID | DEFERRED | #7175 merged it |
| 15 | 4 | CONVENTION | plan status | BRANCH | boxes unchecked | DEFERRED | before PR |
| 16 | 5 | WARNING | communityhome.js:191 | BRANCH | titles vs read | FIXED | iter 5 |
| 17 | 5 | WARNING | communityfollow.js:317 | BRANCH | non-UUID unseen tier | FIXED | iter 5 |
| 18 | 5 | WARNING | communityfollow.js:293 | BRANCH | failed-page test | FIXED | iter 9 |
| 19 | 6 | WARNING | communityfollow.js:268 | BRANCH | no-id dedup key | FIXED | iter 6 |
| 20 | 7 | WARNING | communityhome.js:207 | BRANCH | titles ORDER claim | FIXED | iter 7 |
| 21 | 8 | WARNING | communityfollow.js:323 | BRANCH | read length | DEFERRED | maximum unchanged |
| 22 | 9 | WARNING | communityfollow.js:289 | BRANCH | missing countedFollowing throws | FIXED | iter 9 |

### Outstanding questions
None.

### NITs (non-blocking, across all iterations)
- Triple filter over `older` (iteration 3); fine at 20 items.
- Moving-feed parses the post number from the body (iteration 5); kept.
- Control arms pin the current limit (iteration 3); they are what shows the measure can see a loss.
- `nowMs` / clock at the 24-hour edge (iteration 6); one `nowMs` per read now.
- Split the try line (iteration 7); done in iteration 9.
- countedFollowing's UUID check repeats unseen's (iteration 8); harmless, same rule.
- Home's fresh is not deduplicated by id (iteration 10); one fetch, no duplicates today.

### Strengths (across all iterations)
- The moving-feed test measures the real failure in items and has controls that show it can see a loss.
- Home and the read share one rule (countedFollowing), and each tier is pinned by a direct test with mutations.
- The plan names the weakest premise (arrival rate in items), the cost, and what was rejected.
