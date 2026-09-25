---
pre_challenge: true
method: challenge-loop
branch: asp-guards-3821
diff_hash: 9bb0e7bac74f25663d89d2086645e3660deead2bdd16e3145bf932a249831128
validation: passed
subdir_audit: passed
timestamp: 2026-09-25T22:48:07Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (on the same two arms in #3835, closed as superseded by #3834)
**Converged:** Yes (iteration 2 had nothing at WARNING or above)

This branch carries only the two check arms from #3835; #3834's code is what they run against. Both arms were blind
reviewed in #3835's loop:

#### Iteration 1 (sonnet, on #3835)
B31 and its CONTROL reviewed: the injected control sits beside, not under, the bubble, so the CONTROL sees an unlifted
bubble while the old band rule would have lifted the wider chat; the arm aims at the product and can fail. One
WARNING on #3835's code (a stale bubble measure while hidden), which is what B32 was then written for.

#### Iteration 2 (sonnet, on #3835)
B32 reviewed: it has teeth (the pre-fix measure keeps the chat at 80px; with the fix it comes down to 16) and its wait
covers a tick of the assistant. Nothing at WARNING or above.

## Negative controls
Measured on #3835's equivalent code: the old panel lift fails B31 (the chat 174px up); measuring the bubble only while
shown fails B32.

## Validation
6j on HEAD: full suite clean (hash 9bb0e7bac74f), subdir audit clean. render-assistant-bubble-3034: 81 pass against main with
#3834.
