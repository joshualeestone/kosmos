---
pre_challenge: true
method: challenge-loop
branch: broaden-7992
diff_hash: aeaaf3364863fe40ca5f28c1fb724be4e12a1f17180635fd6d4b1eb516451351
validation: passed
subdir_audit: passed
timestamp: 2026-11-05T02:54:02Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 14 actionable (1 BLOCKER, 12 WARNINGs, 1 CONVENTION) plus 1 from the closing gate, about 12 NITs
**Fixed:** 14 | **Deferred:** 1 | **Asked (awaiting user):** 0

Closing gate (6j): the first run failed engine.reachable.test.js (the new test seam _setSuggestWaitMs had no excuse);
fixed in d1c30298d9 by excusing it by name with its reason, as its sibling seams are. A run beside another full suite
then failed only tools.win-publish-node-bounded-7951 (a 55 s pwsh harness limit, a file this branch does not touch;
passes alone). Run with no other suite beside it: 26705 pass, 0 fail (load average about 2 to 3).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 5 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 0 of the above
- [BLOCKER] engine/communityfollow.js:421 - the follow command quoted an author's self-chosen name: a working shell injection printed in Kosmos's own voice outside the frame --> FIXED (e87b0c9daf)
- [WARNING] engine/communityfollow.js:411 - self excluded only by name --> FIXED: communityself.isOwn (e87b0c9daf)
- [WARNING] engine/communityfollow.js:421 - wording conflicted with the community block's step 4 --> FIXED (e87b0c9daf)
- [WARNING] engine/communityfollow.js:409 - an empty read could suggest the saturated channel --> FIXED: nothing on an empty read (e87b0c9daf)
- [WARNING] engine/communityfollow.js:523 - the suggestion added up to 3 s after the read --> FIXED: started with the read (e87b0c9daf)
- [WARNING] test:62 - no readFollowing end-to-end test, no hang test --> FIXED (e87b0c9daf)
- [CONVENTION] engine/communityfollow.js:367 - readFollowing's JSDoc displaced --> FIXED (e87b0c9daf)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 3 of the above
- [WARNING] engine/communityfollow.js:436 - the display name could read as an instruction in Kosmos's own voice --> FIXED: named by @handle only (5f90088d57)
- [WARNING] engine/communityfollow.js:405 - two extra requests on every read while nothing was found --> FIXED: one-hour backoff (5f90088d57)
- [WARNING] engine/communityfollow.js:417 - requests sent on reads that returned early --> FIXED: started only once the feed answered with items (5f90088d57)
- [WARNING] engine/communityfollow.js:433 - the by-name follow check compared the scrubbed name only --> FIXED: raw name too (5f90088d57)
- [WARNING] engine/communityfollow.js:408 - "at most once a day" without a lock --> FIXED: "about once a day" (5f90088d57)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above
- [WARNING] engine/communityfollow.js:442 - the handle is made from the display name, so it can carry the same words --> FIXED: the line names only the channel (72acec1f56)
- [WARNING] engine/communityfollow.js:472 - a read that showed nothing set no backoff --> FIXED (72acec1f56)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/communityfollow.js:475 - early returns after the fetch skip the backoff --> DEFERRED: there is no return between the fetch's start (line 475) and its use (line 559); the unreadable return is at 472, before the fetch
- [NIT] plan text stale --> fixed (87d81953a1)
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | engine/communityfollow.js:421 | BRANCH | author name in a shell command | FIXED | e87b0c9daf |
| 2 | 1 | WARNING | engine/communityfollow.js:411 | BRANCH | self by name only | FIXED | e87b0c9daf |
| 3 | 1 | WARNING | engine/communityfollow.js:421 | BRANCH | wording vs step 4 | FIXED | e87b0c9daf |
| 4 | 1 | WARNING | engine/communityfollow.js:409 | BRANCH | empty read | FIXED | e87b0c9daf |
| 5 | 1 | WARNING | engine/communityfollow.js:523 | BRANCH | serial 3 s | FIXED | e87b0c9daf |
| 6 | 1 | WARNING | test:62 | BRANCH | no end-to-end or hang test | FIXED | e87b0c9daf |
| 7 | 1 | CONVENTION | engine/communityfollow.js:367 | BRANCH | JSDoc displaced | FIXED | e87b0c9daf |
| 8 | 2 | WARNING | engine/communityfollow.js:436 | SELF | name reads as instruction | FIXED | 5f90088d57 |
| 9 | 2 | WARNING | engine/communityfollow.js:405 | SELF | no backoff | FIXED | 5f90088d57 |
| 10 | 2 | WARNING | engine/communityfollow.js:417 | SELF | fetch on early returns | FIXED | 5f90088d57 |
| 11 | 2 | WARNING | engine/communityfollow.js:433 | BRANCH | name compare | FIXED | 5f90088d57 |
| 12 | 2 | WARNING | engine/communityfollow.js:408 | BRANCH | no lock | FIXED | 5f90088d57 |
| 13 | 3 | WARNING | engine/communityfollow.js:442 | SELF | handle carries the name | FIXED | 72acec1f56 |
| 14 | 3 | WARNING | engine/communityfollow.js:472 | SELF | empty read no backoff | FIXED | 72acec1f56 |
| 15 | 4 | WARNING | engine/communityfollow.js:475 | BRANCH | early returns after fetch | DEFERRED | none exist |
| 16 | 6j | BLOCKER | final-validation: yarn test | BRANCH | engine.reachable seam | FIXED | d1c30298d9 |

### NITs (non-blocking, across all iterations)
- the pool is the public feed's newest page (10 posts), so the line may be rare (iterations 2, 4; in the plan)
- the day counts as used once the line is made, even if not delivered (iteration 1; in the comment)
- the feed's newest-first order is the service's (iteration 4; in the plan)

### Strengths (across all iterations)
- The line outside the frame carries only a checked channel slug: no name and no handle (iterations 3, 4)
- Unknown states use no day; a clock moved back never silences the line (iterations 1 to 4)
- Each guard fails its own test when removed: the channel rule, the by-name follow rule, once a day, isOwn, the empty-read rule, the backoff (iterations 1 to 3)
