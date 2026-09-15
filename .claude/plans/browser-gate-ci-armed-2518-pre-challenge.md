---
pre_challenge: true
method: challenge-loop
branch: browser-gate-ci-armed-2518
diff_hash: 4145caf8a97d7772f101f345d817ffb3631ddc7ef28735f4164a1092a80ef875
validation: passed
subdir_audit: passed
timestamp: 2026-09-15T20:26:28Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4 produced zero new BLOCKER/WARNING/CONVENTION)
**Total findings:** 4 actionable (1 BLOCKER, 1 WARNING, 2 CONVENTION-dupes-of-one) + 4 NITs
**Fixed:** 1 BLOCKER, 1 WARNING, 3 NITs | **Deferred:** 1 CONVENTION | **Asked:** 0

The change adds `tools/test-ci-gate-armed-2518.sh` (a static shell guard) and wires it into
`test:shell`. The guard pins the invariants that keep the PR-time browser-check DIFF gates
(#1720 `kosmos_browser_check_gate` + #2518 `kosmos_browser_check_surface_gate`, both inside
`tools/run-tests.sh`, run by `.github/workflows/test.yml` on every PR) ARMED in CI rather than
silently fail-softing to a vacuous pass. Measured, not assumed: CI run 35013011226 shows the
checkout creating `origin/main` and the surface gate executing against the branch diff.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above (nothing had committed yet; ITER_COMMITS empty)
- [CONVENTION] .claude/plans/ -- no plan file for this branch --> DEFERRED (focused single test-file addition under night-shift autonomy; rationale in commit + #2518 card; a full /pplan plan for a static guard test is disproportionate)
- [NIT] RUNTESTS_CALL_RE over-strict (single-line only; a `run: |` refactor would false-RED) --> FIXED (commit d5745d6c)
- [NIT] Part B lacked red-capability coverage for the run-tests invocation assertion --> FIXED (commit d5745d6c)

#### Iteration 2
**Reviewer model:** sonnet (different model from iter 1, per 6a)
**New findings:** 1 BLOCKER, 1 WARNING, 1 CONVENTION (dup)
**Self-generated:** 0 (the buggy lines were in the pre-loop commit 0b6e61b = BRANCH)
**Duplicates of prior findings:** 1 (the plan-file CONVENTION)
- [BLOCKER] coarse/surface gate-invocation assertions did not filter comment-only lines, so a commented-out gate call still matched the substring and falsely PASSED (the comment-false-pass class) --> FIXED (commit 6e2b887a)
- [WARNING] Part B never tested the commented-out perturbation for the gate assertions --> FIXED (commit 6e2b887a)

Model variation earned its keep here: Opus (iters 1 and, later, 3) did not surface the
comment-false-pass BLOCKER; Sonnet did on its first look. kosmos#2032 in practice.

#### Iteration 3
**Reviewer model:** opus (rotation back)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION (dup), 2 NITs
**Self-generated:** 0
**Duplicates of prior findings:** 1 (the plan-file CONVENTION)
- [NIT] a comment described the filter as `grep -vE '^#'` when the code uses `grep -qvE '^[[:space:]]*#'` --> FIXED (commit 45eb2ad3)
- [NIT] Part B covered the run-tests assertion via removal, not comment-out (coverage-by-analogy) --> FIXED (commit 45eb2ad3). The comment-out perturbation initially FAILED because RUNTESTS_CALL_RE contains a `/` that closed the default sed address delimiter; fixed with a `\|...|`-delimited address. The failing arm proved the perturbation non-vacuous.

#### Iteration 4
**Reviewer model:** sonnet (rotation)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION (dup), 1 NIT
**Self-generated:** 0
**Duplicates of prior findings:** 1 (the plan-file CONVENTION)
**Converged** -- no new actionable findings.
- [NIT] header comment says test.yml attributes fetch-depth: 0 "ONLY to #1025" when the comment is #1794-tagged citing #1025 as its mechanism --> NOT FIXED, recorded non-blocking. Iterations 3 and 4 both produced only prose-accuracy NITs about comments just adjusted (the a-loop-can-converge-on-a-target-you-keep-moving / kosmos#120 pattern); the load-bearing claim is confirmed correct, so the loop converged rather than chasing moving prose.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | CONVENTION | .claude/plans/ | BRANCH | No plan file for branch | DEFERRED | Disproportionate for a static guard test; rationale in commit + card |
| 2 | 1 | NIT | test-ci-gate-armed-2518.sh:39 | BRANCH | run-tests assertion over-strict (single-line) | FIXED | d5745d6c |
| 3 | 1 | NIT | test-ci-gate-armed-2518.sh (Part B) | BRANCH | run-tests assertion had no red-capability arm | FIXED | d5745d6c |
| 4 | 2 | BLOCKER | test-ci-gate-armed-2518.sh:105,108 | BRANCH | gate assertions did not filter comment lines (comment-false-pass) | FIXED | 6e2b887a |
| 5 | 2 | WARNING | test-ci-gate-armed-2518.sh (Part B) | BRANCH | no commented-out perturbation for gate assertions | FIXED | 6e2b887a |
| 6 | 3 | NIT | test-ci-gate-armed-2518.sh:58 | SELF | comment understated the filter form | FIXED | 45eb2ad3 |
| 7 | 3 | NIT | test-ci-gate-armed-2518.sh (Part B) | SELF | run-tests red-cap via removal not comment-out | FIXED | 45eb2ad3 |
| 8 | 4 | NIT | test-ci-gate-armed-2518.sh (header) | SELF | fetch-depth attribution imprecise (#1794 vs #1025) | DEFERRED | Cosmetic; load-bearing claim correct; avoid prose-nit spin |

### Outstanding questions (ASKED)
None.

### NITs (non-blocking)
- [NIT] header comment attributes fetch-depth: 0 to "#1025" where test.yml tags it #1794 citing #1025 (iteration 4). Cosmetic; the disarm risk it describes is real and confirmed.

### Strengths (across all iterations)
- COARSE_CALL_RE / SURFACE_CALL_RE are genuinely disjoint (`kosmos_browser_check_gate` is not a substring of `kosmos_browser_check_surface_gate`), verified against run-tests.sh:271/279 (iters 1-4).
- Every pattern is used both as a must-match Part A assertion and as a Part B perturbation predicate, so a silently-never-matching pattern reds Part A rather than passing green; Part B arms fail loud if a perturbation no-ops (iters 3-4).
- The fetch-depth: 0 -> all-heads refspec -> origin/main-resolves invariant is correct, and both gate libs genuinely fail-soft on an unresolvable diff, so the guard targets the real disarm mechanism (iters 1-4).
- Correctly wired into test:shell as an EXECUTED (not bash -n only) test, satisfying the tools.every-test-runs.test.js meta-guard (iters 1-4).
- No em dashes; mirrors the sibling test-browser-checks-workflow.sh structure (parse-YAML, control grep, non-comment matching).
