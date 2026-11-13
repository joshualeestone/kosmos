---
pre_challenge: true
method: challenge-loop
branch: deployserved-8494
diff_hash: 91535152964972ee39e37e82c4d2bb8858e254ff0fd0a6a1150c4e892c19b015
validation: passed (full suite through queued-heavy on 46aa8e0661, rc 0: node 28481 pass / 0 fail of 28997, shell shards all green, which run tools/test-deploy-landed-5471.sh and tools/test-vercel-refusal-7711.sh; origin/main had not moved)
subdir_audit: passed
timestamp: 2026-11-13T08:12:01Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (opus, sonnet)
**Converged:** Yes (iteration 2: no BLOCKER or WARNING; two cosmetic NITs on docs wrapping, left)
**Fixed:** every BLOCKER and WARNING | **Deferred:** 0 | **Asked:** 0

## Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 5 NITs
- [NIT] the failure message claimed a cause it cannot know --> FIXED ("no deployment ... was seen served")
- [NIT] no line before the poll --> FIXED (what it checks, the budget, that Ctrl-C is safe; test)
- [NIT] one line fewer than the failure path (the trap's "removed" lines) --> FIXED
- [NIT] stale #5471 comment and docs/releasing.md --> FIXED
- [NIT] no arm for an exit 0 served only from the 2nd check --> FIXED (test)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 2 NITs (docs line length and phrasing; left)

### Final Ledger
- Mutation: removing the new else branch reds every #8494 check (measured by the author and by reviewer 1, independently).
- Not covered (plan): tools/deploy-site.sh has a weaker form of the gap for a pages-only --publish or autodeploy.
