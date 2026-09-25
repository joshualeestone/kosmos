---
pre_challenge: true
method: challenge-loop
branch: play-policy-doc-718
diff_hash: 68acc2dde137a9f74cfcf565cdcbea2690cbb6d07db297cb2e32ed4ff55ff532
validation: passed (full kosmos sequence on 6cdab06a: 9146 tests, 0 failed)
subdir_audit: passed
timestamp: 2026-09-25T16:47:08Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 on the trimmed branch (after 10 on the earlier full version, see below)
**Reviewer models:** opus, sonnet, opus, then opus for rounds 4 to 8 (the account hit its weekly
Sonnet limit during round 4: a sonnet reviewer failed with HTTP 429 and was re-run on opus)
**Converged:** Yes, at iteration 8 on HEAD 6cdab06a (NITs only)
**Total findings (trimmed):** 13 (0 BLOCKERs, 11 WARNINGs, 2 CONVENTIONs, plus NITs)
**Fixed:** 13 | **Deferred:** 0 | **Asked (awaiting user):** 0

### History
The first version carried a 60-line on-phone tester script for four checks. It went through ten
review rounds, each finding the next edge of a script nobody can run without a phone, and did not
converge. Liu Kang cut the scope (m703) to four items plus two pointer lines. The full version is
kept on branch `play-policy-doc-718-full` (cd9a8541) and card #3699. This branch was rebuilt from
main with the cut scope, and the loop restarted.

The work was parked (m715) during two Josh-priority Cypress demo changes and resumed at round 6.
Between rounds 5 and 6, kosmos-relay #117 and #121 were found already live (production build
eac39e6), so the item changed from "not live yet" to "live", with a check to repeat.

### Per-Iteration Breakdown (trimmed branch)

#### Iteration 1 (opus)
- [WARNING] docs/phone-push-go-live.md : untested behaviour stated as fact --> FIXED (c105da62)
- [WARNING] : a single sha given for the revert would have reverted only #121's proof file --> FIXED (c105da62)
- [WARNING] : Step 10 had no reminder of the second policy read --> FIXED (c105da62, one pointer line)
- [CONVENTION] : the item had no ownership bracket --> FIXED (c105da62)

#### Iteration 2 (sonnet)
- [WARNING] : "added by #121" was wrong; #117 added the switch, #121 extended it --> FIXED (70352ffe)

#### Iteration 3 (opus)
- [WARNING] : restoring only the switch line would leave #121's Android tests failing --> FIXED (65595880: revert all five commits)

#### Iteration 4 (sonnet failed on the Sonnet limit; re-run on opus)
- [WARNING] : the deploy had to be live before the first Play upload --> FIXED (81b9f226)
- [WARNING] .claude/plans/play-policy-doc-718.md : the plan recorded the switch-only undo --> FIXED (81b9f226)
- [CONVENTION] : [Josh] used for a decision, which the legend reserves for accounts, production changes and publishing --> FIXED (81b9f226: "Josh's call")

#### Iteration 5 (opus)
- [WARNING] : a coordinator rollback before 3558f2e also brings checkout back --> FIXED (8ff4d8cb, applied after the park)

#### Iteration 6 (opus)
- [WARNING] : other sections of the doc predate the eac39e6 deploy --> FIXED (f064ffae: pointer to new card #3764, out of this scope)
- [WARNING] : a Play install likely also needs Play's signing key in assetlinks.json --> FIXED (f064ffae)

#### Iteration 7 (opus)
- [WARNING] : "removing the assetlinks route: nothing breaks" no longer held --> FIXED (6cdab06a)

#### Iteration 8 (opus)
NITs only. **Converged.**

### Strengths (across iterations)
- No Play policy detail is stated as fact; unobserved behaviour is labelled as such
- Every claim about kosmos-relay was checked against origin/main and the live build by the reviewers
- The stale parts of the doc outside this scope went to their own card (#3764) instead of widening it
