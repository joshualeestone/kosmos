---
pre_challenge: true
method: challenge-loop
branch: pr-browser-gate-2445
diff_hash: 08e6986f97d98e3b23fab2598038e14dd7d5d48d0be611e07bd0082ffe7a4a9f
validation: passed
subdir_audit: passed
timestamp: 2026-09-08T02:17:00Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (5 original workflow loop + 3 allowlist loop)
**Converged:** Yes
**Total findings:** many across both loops; the allowlist loop's are itemised below.
**Fixed:** most | **Deferred:** the documented tradeoffs below | **Asked:** 0

Two review passes certify this branch. (A) The original per-PR browser-checks
workflow + guard test converged over 5 blind iterations (the workflow file,
provision, path filter, macos-latest, strict-version pin). (B) Tonight the
timing-insensitive DOM-state CI ALLOWLIST (Baron option d) was added and converged
over 3 more blind iterations, itemised here. Origin/main was then merged in to pick
up the fleet control-test fix (#2464) and #2463/#2453; that merge is catch-up (my
allowlist code unchanged, guard test still green, verified) and the branch was
re-validated clean post-merge.

### The allowlist change (B)
`run_one` skips any check not in `KOSMOS_BC_CI_ALLOWLIST` when it is set (unset =
every check runs, so the cut/dev path is byte-identical). A summary guard HARD-FAILS
if the allowlist matches nothing or names a check that never ran (no green from zero
checks). The workflow sets the allowlist to 7 timing-insensitive, headless-robust
DOM-state checks; click-first-run is deliberately excluded (measured headless-weak:
its Welcome->Next transition does not paint #fr-next under SwiftShader). Baron (who
owns the checks) concurred with dropping click-first-run and took the
headless-robust follow-up. browser-checks CI is green on the 7-check subset (~3m20s).

### Per-Iteration Breakdown (allowlist loop)

#### Iteration 1
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
- [WARNING] workflow header asserted the FULL suite runs / "no subset needed" -->
  FIXED: rewritten to the two-scopings model (paths = which PRs pay; allowlist =
  what runs / what a green covers), caveats 1+2 corrected for the click-first-run drop.
- [WARNING] plan file documented the superseded full-suite design --> FIXED: updated
  to option (d).
- [WARNING] board-boot else-branches append whole groups to FAILED unconditionally
  (failure-path noise citing off-allowlist checks) --> DEFERRED: safe false-RED only
  (green invariant holds; allowlisted checks still caught by the never-ran guard);
  gating 12 boot branches is disproportionate risk on this cut-critical driver.
  Documented at the filter site.
- [NIT] "eight" checks in a comment but seven listed --> FIXED.
- [NIT] two bare `grep -q KOSMOS_BC_CI_ALLOWLIST` match prose comments --> FIXED:
  anchored on the env-key and shell-read forms.

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
- [WARNING] `timeout-minutes: 40` justification still cited the full 63-check
  ~15-20 min runtime --> FIXED (subset ~3m20s + provision; full suite is cut-only).
- [NIT] caveat 3 cited the same stale ~15-20 min figure --> FIXED.
- [CONVENTION] plan Q3 cited "pay the ~15-20 min" contradicting its own 3m20s -->
  FIXED.

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Converged** - reviewer confirmed the filter, zero-match guard, and guard-test
anchors all correct (4 strengths).
- [NIT] guard-test comment said "All five entries" but the loop pins six
  (test-support added) --> FIXED.

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### Key strengths (allowlist loop)
- Cut/dev path byte-identical when the allowlist is unset (the filter and summary
  guard both short-circuit) - no regression risk to the release cut.
- Zero-match / never-ran guard is fail-closed and bash-3.2 empty-array safe under
  set -uo pipefail; a typo'd or empty allowlist HARD-FAILS rather than greening.
- Whole-word case match (comma-normalized, space-wrapped) with no substring
  false-positives; all 7 names resolve to real run_one labels.
- Guard test anchors on the YAML env-key / list-item / shell-read forms, not bare
  names the header comments contain, so a prose mention cannot false-pass.
- click-first-run exclusion is measured, not assumed (failed in the isolated subset
  too), and the #2085 gate class stays covered headless by render-gated-next +
  render-connect-skip.
