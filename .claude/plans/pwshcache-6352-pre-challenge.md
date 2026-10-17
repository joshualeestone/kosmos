---
pre_challenge: true
method: challenge-loop
branch: pwshcache-6352
diff_hash: f771bbb0419fb400f8e0a0ffb79d83f50f5227142c5d69e0165a7dddcfd0da74
validation: passed, the full local suite (validation_log_run_or_skip) at a6594591, the head this proof covers: 21410 tests, 21166 pass, 0 fail (start and end heads equal), with pwsh working on this Mac again (fixed 02:06). Base 14fe852ed7; main moved 22 commits since, with no conflict predicted (merge-tree), so the PR's CI is the run against current main.
subdir_audit: passed
timestamp: 2026-10-17T08:56:42Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (sonnet)
**Converged:** Yes. Iteration 1 raised NITs only (no BLOCKER or WARNING).
**Fixed after it:** the export must be at column 0 (mutant with it indented: red); the start pattern also takes $PWSH and ${PWSH}; the sweep's selector limit is stated in the test.
**Documented, not built:** a script that finds pwsh other than by `command -v pwsh` is not swept.

Measured both arms with that night's damaged startup profile as the outer cache: tools/test-publish-r2-3725.sh failed 87 (rc 134) before the change and passed after, with the damaged file untouched. Mutants of the pin test, each red: the export removed; the export below the first pwsh start; the export indented.
