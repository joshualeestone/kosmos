---
pre_challenge: true
method: challenge-loop
branch: planscreen-7404
diff_hash: 9b61ae46df43a762bb634eb7b6cbb7bc6bc51f1a4447213222594ad92c2e28e7
validation: passed
subdir_audit: passed
timestamp: 2026-11-03T06:02:20Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at the 8-round cap of Splinter's standing review rule (fleetbuilders m510, 2026-10-26:
"A review loop stops at 8 rounds unless a BLOCKER is still open. Past 8, WARNINGs go to a follow-up card, not another
round."). No BLOCKER was open at round 8. Its four WARNINGs are kosmos#7827 (claimed by Baron Draxum); one more was not
a finding (see iteration 8).
**Total findings:** 1 BLOCKER, 27 WARNINGs, 2 CONVENTIONs (plus 1 synthetic final-validation BLOCKER), and NITs
**Fixed:** 24 | **Deferred:** 5 | **To follow-up #7827:** 4 | **Asked (awaiting user):** 0

Shas below are after the rebase onto main at 2eee8ce7e4 (#7816 merged).

Validation note: per the queue rule on this Mac (one full suite at a time), each iteration ran the focused tests
(web.pbplans-7404, engine/personalbackup-7404, server.personalbackup-7404) and both browser-check gates; the full suite
ran at 6j. Before it, every web.* test file was run (3571 pass), which found that web.plus-stale's fake element lacked
the dataset the plan screen reads (fixed in 6de4672626). The full suite then passed: 26652 tests, 0 failed, build passed.

Design: Mona Lisa approved the screen (#7404 comment 6593277093) and ruled on every later wording change in
fleetbuilders (m2554, m2557, m2559, m2561). Shots retaken at e75db839ee.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 1 BLOCKER, 8 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [BLOCKER] web/index.html - the hourly run's no-plan stop hid the plan screen it should open --> FIXED (39350c93d8): noPlan carried through the job note, report and page; pbpOnView keeps the screen open
- [WARNING] engine/personalbackup.js - plansNow told an unread plan as "no plan" --> FIXED (39350c93d8)
- [WARNING] engine/personalbackup.js - the preview route was called before status --> FIXED (39350c93d8), status first
- [WARNING] web/index.html - plans read every minute with no Choose --> FIXED (39350c93d8)
- [WARNING] web/index.html - a failed read's refusal outlived a good read --> FIXED (39350c93d8)
- [WARNING] web/index.html - a first failed read was hidden with no rows --> FIXED (39350c93d8)
- [WARNING] engine/personalbackup.js - refusals said "Nothing was turned on" --> FIXED (39350c93d8), own words
- [WARNING] web/index.html - the off view's "from" price unbuilt --> FIXED (39350c93d8)
- [WARNING] plan file - said checkout checks the size --> FIXED (39350c93d8), plan corrected

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html - backup_plan_exists never re-read the plan --> FIXED (08d9cb1c9f)

#### Iteration 3
**Reviewer model:** fable
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/personalbackup.js - any coded refusal told as "already opening" --> FIXED (dc63450cf1)
- [WARNING] engine/personalbackup.js - "try again in a minute" for refusals a retry cannot clear --> FIXED (dc63450cf1)
- [WARNING] web/index.html - a plan lapsing while open was hidden by the cached plan --> FIXED (dc63450cf1), hourly re-read on a no-plan stop
- [WARNING] server.personalbackup-7404.test.js - the new routes had no server tests --> FIXED (dc63450cf1)

#### Iteration 4
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 1 of the above (the wait line written in iteration 1's fix)
- [WARNING] web/index.html - a plan paid elsewhere never replaced the rows --> FIXED (0f01868f5d), hourly read
- [WARNING] web/index.html - the late wait line claimed a payment; minute polling unbounded --> FIXED (0f01868f5d), Mona Lisa's words (m2559) and a 30-minute bound
- [WARNING] web/index.html - the words screen stated a flat price --> FIXED (0f01868f5d), "from"
- [WARNING] engine/personalbackup-7404.test.js - two malformed-list cases could not fail --> FIXED (0f01868f5d)
- [CONVENTION] plan file - said the preview carries plans --> FIXED (0f01868f5d)

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html - a refusal that cannot clear was retried each minute and shown to people whose backups run --> FIXED (41ec58fe82), final, hourly, shown only on a no-plan stop
- [WARNING] server.js - no throttle on the plans read --> FIXED (41ec58fe82), one shared read for 30 seconds
- [WARNING] engine/personalbackup.js - the #7681 price binding refuses a mismatched configured price --> DEFERRED: plan item 2, by design
- [WARNING] engine/personalbackup.js - a malformed plans list refuses turn-on --> DEFERRED: plan item 1, by design

#### Iteration 6
**Reviewer model:** fable
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 1 of the above (the 30-second cache, written in iteration 5's fix)
- [WARNING] server.js - the cache served the old answer after backup_plan_exists --> FIXED (31e4684fe3)
- [WARNING] engine/personalbackup.js - a status never sent was told as Kosmos+ answering --> FIXED (31e4684fe3)
- [WARNING] web.pbplans-7404.test.js - nothing tested the job's noPlan reaching the screen --> FIXED (31e4684fe3)

#### Iteration 7
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the cache again)
- [WARNING] server.js - on, off and restore did not clear the cache --> FIXED (54ede91e82), every step clears it before and after
- [WARNING] engine/personalbackup.js - every coded preview refusal made final --> FIXED (54ede91e82), only known-final codes
- [WARNING] web/index.html - a read racing a checkout can be a minute old --> DEFERRED: cannot charge anyone; the next read corrects it

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 of the above (the cache)
- [WARNING] server.js - "the cache has no test" --> DEFERRED: not a finding; the server test counts Kosmos+ reads, shared within 30 s and asked again after checkout and Off
- [WARNING] server.js - a failure cached for 30 s --> FOLLOW-UP #7827 (8-round cap)
- [WARNING] server.js - a rejected read cached --> FOLLOW-UP #7827
- [WARNING] engine/personalbackup.js - no test that another org's status sends no preview --> FOLLOW-UP #7827
- [WARNING] engine/personalbackup.js - two tabs can open two checkout pages --> FOLLOW-UP #7827 (Ice Cream Kitty m2563: the relay allows one open page; a nicety)

#### Final validation (6j)
- [BLOCKER] final-validation: web.plus-stale's fake element had no dataset (found by the web.* sweep before the full run) --> FIXED (6de4672626)

### Outstanding questions (ASKED)
None.

### NITs (non-blocking, across all iterations)
- smallest plan assumed cheapest for the "from" figure (1); a regex-over-source test, since replaced by a run (1)
- preview returns plans the server drops (3, 7); unfocused tabindex on the wait line (3); test header (3)
- client Stripe regex is a second check only (2, 5); focus after Choose on a hidden link (5)
- "from" with one plan on sale (4, 7); a hung fetch leaves PBP.reading set (4, 8)
- :has() needs WebKit 15.4+ (6); a tampered size answers backup_plan_unknown (4, 6)

### Strengths (across all iterations)
- The payment link is checked at both ends: engine https + exact host, no userinfo or port; page regex; the person presses it
- The client sends a size, never a price; checkout is step-up gated, the plans read deliberately not
- Status before the membership-making preview route, and the answer's org checked again
- noPlan carried from the hourly run to the screen, with a test on each joint
- Every fix carries a test that goes red under its own mutant
