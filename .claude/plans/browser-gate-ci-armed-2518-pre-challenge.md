---
pre_challenge: true
method: challenge-loop
branch: browser-gate-ci-armed-2518
diff_hash: d9af495081b5d3f9cf58a984d94dc4ce350e9642cc41a92232d787583517b9a3
validation: passed
subdir_audit: passed
timestamp: 2026-09-15T20:42:32Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iteration 6 found no issues at all)
**Total findings:** 1 BLOCKER, 1 WARNING, 1 CONVENTION (re-raised each pass), 5 NITs
**Fixed:** 1 BLOCKER, 1 WARNING, 5 NITs | **Deferred:** 1 CONVENTION | **Asked:** 0

The change adds `tools/test-ci-gate-armed-2518.sh` (a static guard) + one line of `test:shell`
wiring + a design plan file. The guard keeps the PR-time browser-check DIFF gates (#1720
`kosmos_browser_check_gate` + #2518 `kosmos_browser_check_surface_gate`, both inside
`tools/run-tests.sh`, run by `.github/workflows/test.yml` on every PR) ARMED in CI rather than
silently fail-softing to a vacuous pass. Measured, not assumed: CI run 35013011226 shows the
checkout creating `origin/main` (via `fetch-depth: 0`) and the surface gate executing against the
branch diff.

Model rotation earned its keep: iteration 2 (Sonnet) surfaced a comment-false-pass BLOCKER that
iterations 1/3 (Opus) missed, and iteration 5 (Opus) surfaced a missing-trigger-assertion WARNING.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 CONVENTION, 2 NITs
**Self-generated:** 0 (nothing committed yet)
- [CONVENTION] .claude/plans/ -- no plan file --> initially DEFERRED, later RESOLVED (plan file added at iteration 5's commit range; the pre-challenge-gate hard-requires it)
- [NIT] run-tests assertion over-strict (single-line only) --> FIXED (d5745d6c)
- [NIT] Part B lacked a red-capability arm for the run-tests assertion --> FIXED (d5745d6c)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 1 WARNING, 1 CONVENTION (dup)
**Self-generated:** 0 (the buggy lines were in the pre-loop commit = BRANCH)
- [BLOCKER] coarse/surface gate assertions did not filter comment-only lines (comment-false-pass) --> FIXED (6e2b887a)
- [WARNING] Part B never tested the commented-out perturbation for the gate assertions --> FIXED (6e2b887a)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 CONVENTION (dup), 2 NITs
**Self-generated:** 0
- [NIT] a comment understated the filter form --> FIXED (45eb2ad3)
- [NIT] run-tests red-cap via removal not comment-out --> FIXED (45eb2ad3); the comment-out perturbation initially FAILED (RUNTESTS_CALL_RE contains a `/` that closed the default sed address delimiter) and was fixed with a `\|...|` address -- the failing arm proved the perturbation non-vacuous

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 1 CONVENTION (dup), 1 NIT
**Self-generated:** 0
- [NIT] header comment imprecise on the #1025/#1794 attribution --> FIXED at iteration 5 (recurred, so fixed rather than left to keep re-surfacing)

#### Iteration 5
**Reviewer model:** opus (reviewed code + the newly-added plan file)
**New findings:** 1 WARNING, 2 NITs
**Self-generated:** the reviewed lines were mostly loop-authored (SELF) but all are CODE, fixed normally
- [WARNING] guard did not pin that test.yml still TRIGGERS the suite on feature/PR branches --> FIXED (1adfd375): added a pull_request-OR-push:[**] disjunction assertion + its Part B "narrow both triggers" perturbation
- [NIT] FETCH_DEPTH_RE end-anchored right after 0 (a trailing inline comment would false-RED) --> FIXED (1adfd375): now tolerates `(#.*)?$`
- [NIT] #1025-vs-#1794 attribution (in test comment + plan file) --> FIXED (1adfd375)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0. **Converged** -- no issues found, all arms verified non-vacuous by direct diff of perturbed copies.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | CONVENTION | .claude/plans/ | BRANCH | No plan file for branch | RESOLVED | plan file added (19ded3a / 1adfd37) |
| 2 | 1 | NIT | test-ci-gate-armed-2518.sh | BRANCH | run-tests assertion over-strict | FIXED | d5745d6c |
| 3 | 1 | NIT | test-ci-gate-armed-2518.sh | BRANCH | run-tests assertion had no red-cap arm | FIXED | d5745d6c |
| 4 | 2 | BLOCKER | test-ci-gate-armed-2518.sh | BRANCH | gate assertions did not filter comment lines | FIXED | 6e2b887a |
| 5 | 2 | WARNING | test-ci-gate-armed-2518.sh | BRANCH | no commented-out perturbation for gate assertions | FIXED | 6e2b887a |
| 6 | 3 | NIT | test-ci-gate-armed-2518.sh:58 | SELF | comment understated the filter form | FIXED | 45eb2ad3 |
| 7 | 3 | NIT | test-ci-gate-armed-2518.sh | SELF | run-tests red-cap via removal not comment-out | FIXED | 45eb2ad3 |
| 8 | 4 | NIT | test-ci-gate-armed-2518.sh | SELF | #1025/#1794 attribution imprecise | FIXED | 1adfd375 |
| 9 | 5 | WARNING | test-ci-gate-armed-2518.sh | SELF | no assertion that test.yml triggers on feature/PR branches | FIXED | 1adfd375 |
| 10 | 5 | NIT | test-ci-gate-armed-2518.sh | SELF | FETCH_DEPTH_RE would false-RED on a trailing comment | FIXED | 1adfd375 |

### Outstanding questions (ASKED)
None.

### NITs (non-blocking, all fixed)
All NITs raised were fixed in-loop; none deferred.

### Strengths (across all iterations)
- COARSE_CALL_RE / SURFACE_CALL_RE are genuinely disjoint (`kosmos_browser_check_gate` is not a substring of `kosmos_browser_check_surface_gate`), verified against run-tests.sh:271/279.
- Every pattern is used as both a Part A must-match assertion and a Part B perturbation predicate, so a silently-never-matching pattern reds Part A rather than passing green; Part B arms fail loud if a perturbation no-ops (proven when the run-tests comment-out perturbation initially failed on a sed delimiter bug).
- The fetch-depth: 0 -> all-heads refspec -> origin/main-resolves invariant is correct, both gate libs genuinely fail-soft on an unresolvable diff, and the guard targets the true disarm mechanism.
- Trigger disjunction and comment-false-pass filters verified against the real test.yml/run-tests.sh bytes and confirmed comment-safe.
- Correctly wired into test:shell as an EXECUTED (not bash -n only) test, satisfying tools.every-test-runs.test.js. No em dashes. Portable on macos-latest (BSD sed/grep), verified live.
