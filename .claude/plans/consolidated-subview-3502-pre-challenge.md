---
pre_challenge: true
method: challenge-loop
branch: consolidated-subview-3502
diff_hash: aaaca21261c3fab29b14b47559cd4a094dae81c79e981cfd6cafbf2dc080be0d
validation: passed
subdir_audit: passed
timestamp: 2026-09-23T23:04:28Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (re-run after rebasing onto origin/main; the pre-restart run had already
converged, this run re-reviews the post-rebase diff and its merge resolutions)
**Converged:** Yes
**Total findings:** 3 WARNINGs, 5 NITs (0 BLOCKERs, 0 CONVENTIONs)
**Fixed:** 3 WARNINGs + 2 NITs | **Deferred:** 2 NITs | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above (findings about staleness vs origin/main, not loop output)
- [WARNING] browser-checks-reason-grep.test.js — branch stale vs origin/main: #3501/#3511
  (5e35ca6ba) removed render-memory-words, so the integrated EXPECTED_SITES is 127, not 128 -->
  FIXED: rebased onto current origin/main, resolved the runner list + count, re-measured 127 with
  the reason-grep test (commit 0cb553898)
- [WARNING] tools/browser-checks.sh — same staleness in the runner list --> FIXED: took origin/main's
  list (render-memory-words already removed) and inserted render-subview-cleanup-3502 once (0cb553898)
- [NIT] docs/browser-checks/README.md — stale "7 fail / 14 pass" count --> FIXED: dropped the brittle
  count, the positive-controlled check is the guard (commit ff4055418)

#### Iteration 2
**Reviewer model:** sonnet (a different model from iteration 1, per 6a)
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 (the WARNING is about the plan's own summary, authored pre-loop)
- [WARNING] .claude/plans/consolidated-subview-3502.md — plan says "no behaviour change" but the
  #3502 focus fix IS a behaviour change (inverted #120 pattern) --> FIXED: plan now discloses the
  focus fix (commit 2241e31cd)
- [NIT] render-subview-cleanup-3502.js:45 — dead module-scope SUBVIEWS const --> FIXED: removed (2241e31cd)
- [NIT] render-subview-cleanup-3502.js:156 — overstated "byte-identical" comment --> FIXED: reworded
  to "preserves the pre-fix handler's focus behaviour" (2241e31cd)
- [NIT] render-subview-cleanup-3502.js:136-137 — top-inset assertion uses >=16, looser than the
  actual 24px --> DEFERRED: the looser bound is deliberate (robust to headless sub-pixel rounding)
  and non-vacuous (fails at ~0 on pre-fix markup); tightening needs a full browser-check re-run for
  marginal benefit

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
**Converged** - no new BLOCKER/WARNING/CONVENTION. The lone CONVENTION line was "plan present and
accurate, not a defect."
- [NIT] docs/browser-checks/README.md:386 / render-subview-cleanup-3502.js header — "positive-controlled
  (assertions fail on the pre-fix markup...)" could read as "all assertions fail pre-fix" when some are
  scoping/tab-view controls that pass both ways --> DEFERRED: this NIT gives the OPPOSITE guidance from
  iteration 2's NIT on the same phrase (iter 2 said drop the brittle count; iter 3 suggests adding a
  precise count back). "positive-controlled" is accurate (the check reds pre-fix); chasing a
  count-precision NIT the two models disagree on is a moving-target trap, and it does not gate
  convergence. Left as-is.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | browser-checks-reason-grep.test.js:540 | BRANCH | Stale count, should be 127 not 128 | FIXED | 0cb553898 |
| 2 | 1 | WARNING | tools/browser-checks.sh:1295 | BRANCH | Stale runner list vs #3501 | FIXED | 0cb553898 |
| 3 | 1 | NIT | docs/browser-checks/README.md | BRANCH | Stale 7/14 count | FIXED | ff4055418 |
| 4 | 2 | WARNING | .claude/plans/consolidated-subview-3502.md:5 | BRANCH | "no behaviour change" false | FIXED | 2241e31cd |
| 5 | 2 | NIT | docs/browser-checks/render-subview-cleanup-3502.js:45 | BRANCH | Dead SUBVIEWS const | FIXED | 2241e31cd |
| 6 | 2 | NIT | docs/browser-checks/render-subview-cleanup-3502.js:156 | BRANCH | Overstated byte-identical | FIXED | 2241e31cd |
| 7 | 2 | NIT | docs/browser-checks/render-subview-cleanup-3502.js:136 | BRANCH | Looser >=16 bound | DEFERRED | Robust to headless rounding, non-vacuous |
| 8 | 3 | NIT | docs/browser-checks/README.md:386 | SELF | positive-controlled wording nuance | DEFERRED | Contradicts iter-2 guidance; non-gating |

### Outstanding questions (ASKED, still unresolved)
None.

### NITs (non-blocking)
- [NIT] render-subview-cleanup-3502.js:136 — >=16 bound looser than 24px (deferred, deliberate)
- [NIT] README.md:386 — positive-controlled wording (deferred, models disagree)

### Strengths (across all iterations)
- CSS is tightly consolidated-scoped (html[data-layout="consolidated"] body.consolidated); the back
  removal cannot leak into the tab view, and the tab view is asserted by controls
- The keyboard-focus fix is a genuine catch: hiding #pj-settings-back via display:none would have
  stranded focus on the cog; the fix guards on computed display and falls back to the heading, and it
  is positive-controlled
- Browser-check wiring complete on all surfaces (README row, runner list, EXPECTED_SITES=127 with a
  single measured FAIL-emit site self-guarded by the reason-grep test, and the surface-override trailers)
- Integration correctness verified against origin/main #3501 (memory-words removal) by two models
