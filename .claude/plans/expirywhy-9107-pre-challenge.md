---
pre_challenge: true
method: challenge-loop
branch: expirywhy-9107
diff_hash: eca9e965fe298b5f778d3cd01288aef0e6918048b71191ff5ae4b1f602a62e6e
validation: passed
subdir_audit: passed
timestamp: 2026-11-26T15:27:04Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes
**Total findings:** 24 (2 BLOCKERs, 17 WARNINGs, 2 CONVENTIONs, 3 counted NITs acted on; further NITs listed below)
**Fixed:** 17 | **Deferred:** 6 | **Asked (awaiting user):** 0
**Validation:** passed on Mortals at 49b7f5b41e (entry status clean, hash eca9e965fe29; 31,343 node tests, 0 failed, 617 skipped; four shell shards green; the three #9107 tests ran).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** default (opus)
**New findings:** 1 BLOCKER, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [BLOCKER] engine/loginexpiry.js fileBodyNow - a sign-in kept the old login notice up to 5 minutes (#5018 again) --> FIXED (b2c7cc5e65; later removed with item 4)
- [WARNING] engine/loginexpiry.js - plan claimed the snapshot never waits on the home --> FIXED (claim narrowed)
- [WARNING] engine/loginexpiry.js - every access-token refresh moved the login generation --> FIXED (b2c7cc5e65; later removed with item 4)
- [WARNING] engine/loginexpiry-why-9107.test.js - fixed 200 ms waits --> FIXED
- [WARNING] engine/loginexpiry-why-9107.test.js - a read left running past a test --> FIXED
- [NIT] test user-name check, sync-mock comment, Linux case-fold, readCredDefault doc --> fixed

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 3 of the above (all in iteration 1's background-read code)
- [WARNING] engine/loginexpiry-why-9107.test.js - sign-in controls could not fail --> FIXED (0574bb0ed5)
- [WARNING] engine/loginexpiry.js - stalled reads could exhaust libuv's pool --> FIXED (0574bb0ed5; later removed with item 4)
- [WARNING] engine/loginexpiry.js - a torn body hid the warning a minute --> FIXED (0574bb0ed5; later removed with item 4)
- [NIT] account line unreachable through the board's calls (kept, plan says why); move-during comment; load-time test log

#### Iteration 3
**Reviewer model:** default (opus)
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 5 NITs
**Self-generated:** 3 of the above
- [WARNING] engine/loginexpiry.js - EBUSY cleared the warning --> FIXED (460b963160; later removed with item 4)
- [WARNING] engine/loginexpiry.js - a broken file kept an old date for good --> FIXED (460b963160; later removed with item 4)
- [WARNING] engine/loginexpiry.js - the read cap was this reader's only --> FIXED (documented; later removed with item 4)
- [CONVENTION] engine.reachable.test.js - _resetForTests had no EXCUSED reason --> FIXED
- [NIT] one clock for scheduling --> DEFERRED: production uses Date.now() throughout

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 3 of the above
- [WARNING] engine/loginexpiry.js - a read could be counted out twice --> FIXED (a7f3c63929; later removed with item 4)
- [WARNING] engine/loginexpiry.js - bad-read retries unspaced --> DEFERRED: callers call only on a recompute, minutes apart
- [WARNING] engine/loginexpiry.js - one refusal line per kind, not per account --> DEFERRED: the card's ask

#### Iteration 5
**Reviewer model:** default (opus)
**New findings:** 1 BLOCKER, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 5 of the above
- [BLOCKER] engine/loginexpiry.js - with three or more accounts, those after the first two were never read again --> FIXED by removing item 4 (bd5eac81b9): five rounds found defects in the loop's own fixes; the read is synchronous again, as on main; what a working version needs is on kosmos#9107
- [WARNING] timing comments, slot never freed, startup generation burst, no test through computeLoginAdvisories --> resolved by the same removal

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings:** 2 (the account line's reach, iteration 2; the load-time test log, iteration 2)
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | engine/loginexpiry.js | BRANCH | sign-in kept the old notice | FIXED | b2c7cc5e65, then item 4 removed (bd5eac81b9) |
| 2 | 1 | WARNING | .claude/plans/expirywhy-9107.md | BRANCH | plan overclaimed | FIXED | b2c7cc5e65 |
| 3 | 1 | WARNING | engine/loginexpiry.js | BRANCH | token refresh moved the generation | FIXED | removed with item 4 |
| 4 | 1 | WARNING | engine/loginexpiry-why-9107.test.js | BRANCH | fixed-time waits | FIXED | b2c7cc5e65 |
| 5 | 1 | WARNING | engine/loginexpiry-why-9107.test.js | BRANCH | read leaked past a test | FIXED | b2c7cc5e65 |
| 6 | 2 | WARNING | engine/loginexpiry-why-9107.test.js | SELF | controls could not fail | FIXED | 0574bb0ed5 |
| 7 | 2 | WARNING | engine/loginexpiry.js | SELF | libuv pool exhaustion | FIXED | removed with item 4 |
| 8 | 2 | WARNING | engine/loginexpiry.js | SELF | torn body hid warning | FIXED | removed with item 4 |
| 9 | 3 | WARNING | engine/loginexpiry.js | SELF | EBUSY cleared warning | FIXED | removed with item 4 |
| 10 | 3 | WARNING | engine/loginexpiry.js | SELF | broken file kept old date | FIXED | removed with item 4 |
| 11 | 3 | WARNING | engine/loginexpiry.js | SELF | cap local only | FIXED | removed with item 4 |
| 12 | 3 | CONVENTION | engine.reachable.test.js | BRANCH | _resetForTests unexcused | FIXED | 460b963160 |
| 13 | 3 | NIT | engine/loginexpiry.js | SELF | one clock | DEFERRED | production uses Date.now() |
| 14 | 4 | WARNING | engine/loginexpiry.js | SELF | double count-out | FIXED | removed with item 4 |
| 15 | 4 | WARNING | engine/loginexpiry.js | SELF | retry spacing | DEFERRED | callers already minutes apart |
| 16 | 4 | WARNING | engine/loginexpiry.js | BRANCH | one line per kind | DEFERRED | the card's ask |
| 17 | 5 | BLOCKER | engine/loginexpiry.js | SELF | third account never read | FIXED | item 4 removed, bd5eac81b9 |
| 18 | 5 | WARNING | engine/loginexpiry.js | SELF | timing comments wrong | FIXED | removed with item 4 |
| 19 | 5 | WARNING | engine/loginexpiry.js | SELF | stalled slot never freed | FIXED | removed with item 4 |
| 20 | 5 | WARNING | engine/loginexpiry.js | SELF | startup generation burst | FIXED | removed with item 4 |
| 21 | 5 | WARNING | engine/loginexpiry-why-9107.test.js | SELF | no test through computeLoginAdvisories | FIXED | removed with item 4 |
| 22 | 2 | NIT | engine/loginexpiry.js | BRANCH | account line unreachable | DEFERRED | kept for direct callers; plan says so |
| 23 | 2 | NIT | engine/loginexpiry.js | BRANCH | log chosen at load | DEFERRED | harmless; tests set the log |
| 24 | 1 | NIT | engine/loginexpiry-file-9097.test.js | BRANCH | Linux case-fold | FIXED | fold only on win32/darwin |

### NITs (non-blocking, across all iterations)
- `refused('outside')` also covers a folder equal to the home itself (iteration 6)
- a home placed under the temp folder would trip the sandbox test (iteration 6)
- `_resetForTests` shares its name with other modules; excused with a reason (iteration 6)

### Strengths (across all iterations)
- Refusal lines are fixed words: no path, user name or credential, said once per kind, and a log failure cannot break a read (iterations 1-6)
- The #9097 guards test compares the real file resolved and case-folded where the file system ignores case (iterations 1-6)
- The plan states plainly why item 4 was taken out and what a working version needs (iterations 5-6)
