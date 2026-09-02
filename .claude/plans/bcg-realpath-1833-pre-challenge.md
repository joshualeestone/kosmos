---
pre_challenge: true
method: challenge-loop
branch: bcg-realpath-1833
diff_hash: 8717b1de18f8f4d6cccaeaf95681bdeaf1353d2b89a139f9c2f932d2f7f7ed6a
validation: passed
subdir_audit: passed
timestamp: 2026-09-02T11:45:37Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 returned zero NEW BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 1 WARNING, 3 NITs (2 resolved by the iter-1 rewrite, 1 doc-only), 9 STRENGTHs
**Fixed:** 1 WARNING + 2 NITs | **Deferred:** 0 | **Asked:** 0

**Validation note:** the change is to one shell test file. Validated targeted:
`bash tools/test-browser-check-gate.sh` -> all 8 arms pass; `bash -n` clean. The full
`tools/run-tests.sh` suite was NOT run locally under the standing no-local-full-suite
constraint (it spawns test-install.sh and trips the cut-guard, kosmos#1796); the repo's
advisory `test` CI runs the full suite on push -- which is the very workflow this change
fixes the false-red on.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
- [WARNING] tools/test-browser-check-gate.sh:121-127 -- `assert rc in {0,1}` was
  near-vacuous: the gate fail-softs a broken git path to rc 0 (browser-check-gate.sh:
  59-64), so rc-in-{0,1} could not tell a real verdict from a swallowed failure, catching
  only a rc>1 shell crash. --> FIXED (commit 3c394527): replaced with two base-PINNED arms
  asserted at exact rc via the `check` helper -- base=HEAD (empty diff -> real diff+log ->
  rc 0, also catches a gate wrongly refusing an empty diff) and base=<unresolvable ref>
  (git diff errors -> fail-soft -> rc 0). Both branch-independent.
- [NIT] comment: "rc >1 is a real crash (git/gate error)" -- imprecise; a git error
  fail-softs to 0, only a shell abort gives rc>1. --> FIXED (3c394527): comment rewritten,
  no longer claims a git error reaches the else-branch.
- [NIT] arm hand-rolled PASS/FAIL instead of the `check` helper. --> FIXED (3c394527): the
  two new arms use the existing `check` helper (uniform with the file's other arms).

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Converged** -- no new actionable findings.
- [NIT] tools/test-browser-check-gate.sh:121-124 -- the base=HEAD arm's real unique value
  is exercising the live git subprocess/`set -u` block; the comment could state that more
  directly than "catches a gate that wrongly refused an empty diff." Reviewer: doc-only, no
  code change needed. --> Addressed post-convergence (commit e231e60f) by a doc-only comment
  naming run-tests.sh:118 as the real enforcement and warning against re-adding a
  branch-dependent enforcement arm here.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/test-browser-check-gate.sh:121 | near-vacuous rc-in-{0,1} assertion | FIXED | 3c394527 |
| 2 | 1 | NIT | tools/test-browser-check-gate.sh (comment) | "git error -> rc>1" imprecise | FIXED | 3c394527 |
| 3 | 1 | NIT | tools/test-browser-check-gate.sh:121 | hand-rolled PASS/FAIL vs check helper | FIXED | 3c394527 |
| 4 | 2 | NIT | tools/test-browser-check-gate.sh:121 | comment could state unique value directly | FIXED | e231e60f (doc-only) |

### NITs (non-blocking)
- (all three NITs above were addressed, not deferred)

### Strengths (across all iterations)
- Iter 1: correctly identifies and removes the branch-dependent false-red that was the real
  kosmos#1833, with an accurate reproduction (base=HEAD^ web/ commit -> rc 1 -> old arm failed).
- Iter 2: the two new arms are red-capable and non-vacuous (they are the ONLY arms that execute
  the real git-invocation block, lib lines 51-70; the 12 seam arms bypass git); branch-dependence
  removed; coverage strictly increased (fail-soft path now explicitly exercised); shell correctness
  holds under `set -uo pipefail` (prefix env assignment on a function call does not leak; subshell
  exit captured before `check`); comment claims accurate.

### Cross-reference (Splinter's #1833 thread, verified after convergence)
The browser-check ENFORCEMENT is run-tests.sh:118 (the gate run seam-free against the branch),
NOT this self-test arm. Measured: after this fix, a web/-uncovered branch STILL reds via line 118
with the clear "#1720: touches web/ but updates no docs/browser-checks/ assertion" message; this
fix only removed a redundant branch-dependent duplicate that was mislabeled as a self-test and
preempted line 118's clearer message. Enforcement is not weakened. e231e60f documents this in the
code so it is not re-introduced.
