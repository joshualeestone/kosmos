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

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**Checked and clean:**
- Nothing else in tools/test-publish-r2-3725.sh reads XDG_CACHE_HOME (node, python3, env, mktemp do not); the trap on $TMP removes the folder; a Windows-hosted CI ignores the variable.
- Every pwsh start (in $(...) subshells, a function, plain calls) inherits the export; the `env -u ...` wrappers unset only named variables; no `env -i` scrubs it.
- tools/test-ci-runner-setup-4601.sh only writes a fake pwsh and never matches `command -v pwsh`, so the sweep rightly skips it.
**Findings:**
- [NIT] tools.pwsh-cache-6352.test.js firstPwshRun: a start written as $PWSH, "${PWSH}" or via another variable name was not recognised --> FIXED ($PWSH and ${PWSH} quoted or not; the variable-name limit stated)
- [NIT] the sweep selects only scripts with `command -v pwsh` (not `which`, `type -P` or a fixed path) --> DOCUMENTED in the test header, not built
- [NIT] the export check could pass with the export inside an if or a function body --> FIXED (column 0 required; mutant with it indented: red)
- [NIT] the plan's mutant claims were not re-run by the reviewer --> no change; they are re-run above and in the PR body
