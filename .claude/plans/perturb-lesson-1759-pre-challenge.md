---
pre_challenge: true
method: challenge-loop
branch: perturb-lesson-1759
diff_hash: f11b5d72893ea1cd811cc34b0e8bbc9b459061a477f0698a9128b64a1e95cf89
validation: passed
subdir_audit: passed
timestamp: 2026-09-01T19:27:02Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes (iteration 1 returned no BLOCKER/WARNING/CONVENTION)
**Total findings:** 0 actionable (plan-file CONVENTION deferred)

> Note on the diff_hash: local `main` is stale, so the hook's three-dot diff spans
> intermediate merged work; the hash matches what the hook computes. The actual
> feature diff is a 14-line comment addition to tools/prove-it-fails.sh.

### The change (a DOWNSCOPE-AND-CLOSE of #1759)
kosmos#1759 is a methodology finding: a perturbation arm that never applied returns
GREEN, indistinguishable from a working guard. Investigation showed the kosmos
repo's canonical perturbation tool (tools/prove-it-fails.sh) ALREADY asserts the
mutation applied (its "THE MUTATION DID NOT APPLY" refusal), and the card's two
vulnerable instances were AD-HOC hand perturbations OUTSIDE this tool (a python3
Rust replace, a perl -0pi workflow edit) that silently never applied. So the
residual is a DISCIPLINE problem for hand perturbations, not a fix and not new
infrastructure.

Per the PM's ruling (option b, on my recommendation against building a helper
adopted by nothing), the discipline is recorded in this tool's header -- the file
someone reads when reaching for perturbation. Five lines where they will be read
beats a shared helper nobody calls.

### Iteration 1 (converged)
No blocker or warning. Four STRENGTHs: the added block is accurate on every
load-bearing claim; it correctly scopes itself to HAND perturbations (does not
duplicate or contradict the tool's own assert-applied refusal); it faithfully
states the finding and prescribes sound discipline (assert the target before
writing; keep perl/shell-special syntax out of a perl -e pattern, prefer python3 +
an assert; when a should-be-RED arm comes back GREEN, suspect the perturbation
before the guard); convention-clean (bash -n passes, no em dash in the added
lines, sensible placement).
- CONVENTION (no plan file): DEFERRED -- directly-routed card.

### Strengths
- Accurate, non-duplicating, correctly-scoped documentation in the right home.
- Comment-only, bash -n clean, no em dashes, full suite green.
