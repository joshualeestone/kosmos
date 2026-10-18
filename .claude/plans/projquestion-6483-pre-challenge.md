---
pre_challenge: true
method: challenge-loop
branch: projquestion-6483
diff_hash: f2e95248e8aca210d357d0ecac8a47383695ad9865b17506cefce4c4ed8b964b
validation: passed
subdir_audit: passed
timestamp: 2026-10-18T15:14:04Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 blind reviews, alternating opus and sonnet
**Converged:** Yes (iteration 4, sonnet: NO NEW ISSUES)
**Fixed:** 5 WARNINGs, 4 NITs | **Filed separately:** #6484 (pre-existing) | **Asked (awaiting user):** 0

Validation: the full suite PASSED on Mortals at a01cf2cd5 (hash f2e95248e8ac, 10:13 CDT 10-18).
render-projects-badges-4730 PASSED (73 checks, 0 failed; the 14 #6483 checks in light and dark, grid and list). The
first browser run failed only the new label checks (the pill text includes its glyph); fixed in a01cf2cd5f, and the
recorded values already showed the behaviour right. Mutation, measured: removing each guard (the by-agent check, the
crash loop, the failed restart, the pill's needsYou, the pill branch, the notice change and its also-only arm) fails
exactly its test. No CLAUDE.md in the diff. Origin: every finding recorded BRANCH.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] a crash-looping questioner made the project calm while its card said "Keeps stopping" --> FIXED (f8ed59dd0a)
- [WARNING] no test failed if the by-agent check was dropped --> FIXED (f8ed59dd0a)
- [NIT] the browser arm read the pill border without asserting it --> FIXED; [NIT] the notice's red "!" for a question
  --> left (out of the card's scope)

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] the pill's needsYou guard untested (an idle project could say Question) --> FIXED (1744e36d5e)
- [WARNING] the failed-restart guard untested --> FIXED (1744e36d5e)
- [NIT] stale #2808 comment --> FIXED

#### Iteration 3
**Reviewer model:** opus
- [WARNING] the notice's also-only arm untested --> FIXED (bfd2af7bfc); [NIT] plan count --> FIXED; [NIT] pjMember
  misses restartFailed (pre-existing on main) --> FILED #6484

#### Iteration 4
**Reviewer model:** sonnet. NO NEW ISSUES.
