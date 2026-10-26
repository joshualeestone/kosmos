---
pre_challenge: true
method: challenge-loop
branch: autobalance-7152
diff_hash: e073ac1875cbe8a994f36e554e2938d2d518e19146690b6a4eb45de43c07eb3c
validation: passed
subdir_audit: passed
timestamp: 2026-10-26T04:17:39Z
iterations: 11
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 11
**Converged:** Yes (iteration 10 found no new BLOCKER, WARNING or CONVENTION. The first full validation after it then failed one test: fixture-discipline.test.js found the engine tests hand-building agent cards. The fix moved them to real cards from test-support/fleet, which showed the guide check in movableFor could never fire (a roster card carries no isGuide), so it was removed and a test pins the absence; two mutants turned red. Iteration 11 reviewed the changed diff and found none. The second full validation passed on that head.)
**Total findings:** 16 (2 BLOCKERs, 14 WARNINGs, 0 CONVENTIONs), plus NITs listed per iteration
**Fixed:** 16 | **Deferred or accepted with a stated reason:** 0 | **Asked (awaiting user):** 0

The two CRITICALs (iterations 1 and 7) are recorded as BLOCKERs. Where a ledger row says "mutant", that fix was checked by a deliberate break that turned its own test or browser check red; the rest (wording asserted by a browser check, comments, the plan) were not mutated, and their rows say how they are covered.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKERs, 6 WARNINGs, 0 CONVENTIONs
**Self-generated:** 0 of the above
- [BLOCKER] web/index.html acctBulkTarget: browser checks 6108 and 6214 stub rows with no bulkTargetable, so every move target reads false --> FIXED (fixtures carry the engine's own answer (withTarget); 6108's mid-test "now full" patch carries false; 6108 456/0, 6214 42/0, 6176 109/0)
- [WARNING] server.js route loop: nothing tests the route sets bulkTargetable --> FIXED (engine markTargets + test; source check that the route calls it; 2 mutants)
- [WARNING] server.js catch / paintAutobalance: "could not work out" can never show (eligible 0 in the catch); its browser fixture was a shape never sent --> FIXED (setting + count read before the guarded decision; fixtures are the real shapes; source check + mutant)
- [WARNING] engine/autobalance-7152.test.js: tie test cannot see the reset rule (earlier reset = earlier folder) --> FIXED (reset and folder order disagree; full-tie arm lists the winner last; 2 mutants)
- [WARNING] web/index.html held line: "none measured is under 70%" can be untrue (memory, five-hour, same login) --> FIXED (neutral "no other account can take them right now")
- [WARNING] engine/autobalance.js decide: an incomplete agent list reads as "Nothing to move" --> FIXED (`short` + page line; test + 2 mutants)
- [WARNING] engine/autobalance.js offerable: an unchecked login qualifies as an automatic target --> FIXED (signedIn (working / signed_in_unverified) for the decision only; bulk move unchanged; test + mutant)
- [NIT] "unchanged" comment (FIXED, the one added test named); misplaced #2619 comment (FIXED); plan departures (FIXED); clock moved to the server, rounding, eager reads, moving agents (NOT taken; rounding and reads in the plan).

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNINGs, 0 CONVENTIONs
**Self-generated:** 1 of the above
- [WARNING] server.js markTargets / web acctBulkTarget: bulkTargetable fixed at the request's start, up to a live check old at paint and click --> FIXED (marked with Date.now() as the answer is sent; source check + mutant)
- [NIT] lines left after a failed read (FIXED, browser case + mutant); guides and mid-move agents (FIXED, test + 2 mutants); no route test for the PUT guard or ?agents=1 (FIXED, server.autobalance-7152.test.js, 5 mutants).

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs
**Self-generated:** 3 of the above
- [WARNING] web/index.html abToggleClick: the switch's repaint can throw away a read the person started, leaving "Checking" --> FIXED (waits for an open read (bounded), then one read; browser case + 2 mutants)
- [WARNING] server.js decision: a second full pane capture per Settings read; a failed one reads "Nothing to move" --> FIXED (walk's roster reused; projects read lazily; unreadable roster refused; tests + 4 mutants)
- [WARNING] server.autobalance-7152.test.js: the route test never reaches the decision (one account) --> FIXED (two accounts, one at 95%; atRisk names it; control at 50%; mutant)
- [NIT] two clocks (FIXED, sentAt + source check + 2 mutants); new switch beside old lines (FIXED, cleared on off; mutant); unreadable setting silent (FIXED, line; mutant); failed save repaint, focus on a hidden switch (NOT taken).

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNINGs, 0 CONVENTIONs
**Self-generated:** 1 of the above
- [WARNING] web/index.html abRepaintAfterReads: the wait never checks the list is shown, so a closed Settings still triggers a live-check read --> FIXED (acctListShown guard; one wait at a time; 2 browser cases + 2 mutants)
- [NIT] two toggles two chains (FIXED, same change); field clock vs weekly clock, reset between polls (ACCEPTED, stated in the plan).

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNINGs, 0 CONVENTIONs
**Self-generated:** 1 of the above
- [WARNING] engine/autobalance-setting.js / web: a corrupt setting shows a confident Off; the "could not read" line is unreachable (its browser case was a fictional shape) --> FIXED (route sends ok; page shows unknown when not ok; real-shape browser case; route test; 2 mutants)
- [NIT] short list drops the reason (FIXED, browser case + mutant); stale header, plan shapes, misplaced route comment (FIXED, prose); "sends off once" asserted >= 1 (FIXED, exactly this press's PUTs); a late read paints the old switch (ACCEPTED, stated in the plan).

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNINGs, 0 CONVENTIONs
**Self-generated:** 0 of the above
- [WARNING] server.autobalance-7152.test.js: no end-to-end test of a real roster card through movableFor and decide --> FIXED (fleet-built agent on the at-risk account: idle is held (movable), working is not; spare-row control; 3 mutants)
- [NIT] acctAutobalance global (NOT taken: one synchronous stretch); 6108 patch hand-sets false (NOT taken: engine test covers the rule); isGuide comment (FIXED); roster age vs sentAt (stated for slice 3).

#### Iteration 7
**Reviewer model:** opus
**New findings:** 1 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs
**Self-generated:** 0 of the above
- [BLOCKER] docs/browser-checks/gated.txt: the new browser check is not wired, so tools.browser-checks-wired goes red and nothing runs it --> FIXED (added in sorted place; wiring test 11/11, and red without the line (control))
- [NIT] "resets in 6 h" beside the 6-hour rule (FIXED, ceil + days, test + 2 mutants); reason said twice (FIXED, browser case + mutant); decision stored before a busy return (NOT taken: the next paint uses it); comment overstated the follow-up (FIXED; the failed follow-up keeping lines is ACCEPTED and stated).

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNINGs, 0 CONVENTIONs
**Self-generated:** 1 of the above
- [WARNING] server.js movable: an unreadable roster says "could not work out" on every read, even with nothing at risk --> FIXED (movableOnDemand (built on first ask); test + source check + 3 mutants)
- [NIT] a target's room not counted across at-risk accounts (stated in the plan for slice 3); paint skipped on the busy early return (NOT taken: matches the stated follow-up behaviour).

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs
**Self-generated:** 0 of the above
- [NIT] 0 BLOCKER, 0 WARNING, 0 CONVENTION (would converge). NITs taken anyway (real behaviour): projects filter, login wording (kind), local decision, route positive arm, moved-rule cases, 6108 engine-computed patch, fsync guard list, comments, plan goal. Not taken: none. A confirming round follows because code changed.

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs
**Self-generated:** 0 of the above
- [NIT] 0 BLOCKER, 0 WARNING, 0 CONVENTION. CONVERGED. NITs iter 10 (NOT taken, the reviewed diff kept as reviewed): two comment blocks above acctBulkTarget; an empty account list skips paintAutobalance (same class as the accepted follow-up case); the decision runs on every ?agents=1 read (cheap unless at risk).

#### Iteration 11
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs
**Self-generated:** 0 of the above
- [NIT] 0 BLOCKER, 0 WARNING, 0 CONVENTION. CONVERGED on 1e55b93fd7. NITs NOT taken (diff kept as reviewed), carried to slice 3: walk's isGuideFolder throw fails open (guide listed; slice 3 must fail closed); a target near its five-hour limit is still picked; a pointer comment to server.allowance-3946.test.js:222; inline require at server.js:13001.
**Converged**: no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web/index.html acctBulkTarget | BRANCH | browser checks 6108 and 6214 stub rows with no bulkTargetable, so every move target reads false | FIXED | fixtures carry the engine's own answer (withTarget); 6108's mid-test "now full" patch carries false; 6108 456/0, 6214 42/0, 6176 109/0 |
| 2 | 1 | WARNING | server.js route loop | BRANCH | nothing tests the route sets bulkTargetable | FIXED | engine markTargets + test; source check that the route calls it; 2 mutants |
| 3 | 1 | WARNING | server.js catch / paintAutobalance | BRANCH | "could not work out" can never show (eligible 0 in the catch); its browser fixture was a shape never sent | FIXED | setting + count read before the guarded decision; fixtures are the real shapes; source check + mutant |
| 4 | 1 | WARNING | engine/autobalance-7152.test.js | BRANCH | tie test cannot see the reset rule (earlier reset = earlier folder) | FIXED | reset and folder order disagree; full-tie arm lists the winner last; 2 mutants |
| 5 | 1 | WARNING | web/index.html held line | BRANCH | "none measured is under 70%" can be untrue (memory, five-hour, same login) | FIXED | neutral "no other account can take them right now" |
| 6 | 1 | WARNING | engine/autobalance.js decide | BRANCH | an incomplete agent list reads as "Nothing to move" | FIXED | `short` + page line; test + 2 mutants |
| 7 | 1 | WARNING | engine/autobalance.js offerable | BRANCH | an unchecked login qualifies as an automatic target | FIXED | signedIn (working / signed_in_unverified) for the decision only; bulk move unchanged; test + mutant |
| 8 | 2 | WARNING | server.js markTargets / web acctBulkTarget | SELF | bulkTargetable fixed at the request's start, up to a live check old at paint and click | FIXED | marked with Date.now() as the answer is sent; source check + mutant |
| 9 | 3 | WARNING | web/index.html abToggleClick | SELF | the switch's repaint can throw away a read the person started, leaving "Checking" | FIXED | waits for an open read (bounded), then one read; browser case + 2 mutants |
| 10 | 3 | WARNING | server.js decision | SELF | a second full pane capture per Settings read; a failed one reads "Nothing to move" | FIXED | walk's roster reused; projects read lazily; unreadable roster refused; tests + 4 mutants |
| 11 | 3 | WARNING | server.autobalance-7152.test.js | SELF | the route test never reaches the decision (one account) | FIXED | two accounts, one at 95%; atRisk names it; control at 50%; mutant |
| 12 | 4 | WARNING | web/index.html abRepaintAfterReads | SELF | the wait never checks the list is shown, so a closed Settings still triggers a live-check read | FIXED | acctListShown guard; one wait at a time; 2 browser cases + 2 mutants |
| 13 | 5 | WARNING | engine/autobalance-setting.js / web | SELF | a corrupt setting shows a confident Off; the "could not read" line is unreachable (its browser case was a fictional shape) | FIXED | route sends ok; page shows unknown when not ok; real-shape browser case; route test; 2 mutants |
| 14 | 6 | WARNING | server.autobalance-7152.test.js | BRANCH | no end-to-end test of a real roster card through movableFor and decide | FIXED | fleet-built agent on the at-risk account: idle is held (movable), working is not; spare-row control; 3 mutants |
| 15 | 7 | BLOCKER | docs/browser-checks/gated.txt | BRANCH | the new browser check is not wired, so tools.browser-checks-wired goes red and nothing runs it | FIXED | added in sorted place; wiring test 11/11, and red without the line (control) |
| 16 | 8 | WARNING | server.js movable | SELF | an unreadable roster says "could not work out" on every read, even with nothing at risk | FIXED | movableOnDemand (built on first ask); test + source check + 3 mutants |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### Strengths (across all iterations)
- Every pass found the bulk move unchanged from origin/main, clause by clause (iterations 2 to 11).
- No email reaches the decision; every page string goes through esc() (all iterations).
