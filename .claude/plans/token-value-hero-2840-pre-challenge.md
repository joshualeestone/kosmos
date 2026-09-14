---
pre_challenge: true
method: challenge-loop
branch: token-value-hero-2840
diff_hash: 44fb184241e14ee3380493190ad0d39893211a6ab01a5f6554085bd8a0bc2eae
validation: passed
subdir_audit: passed
timestamp: 2026-09-14T20:04:17Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10 (opus/sonnet alternating, per kosmos#2032)
**Converged:** Yes (iteration 10 found zero new BLOCKER/WARNING/CONVENTION)
**Total findings:** 4 BLOCKER/WARNING correctness, plus WARNINGs/CONVENTIONs/NITs below
**Fixed:** 20 | **Deferred:** 4 (all with reasoning) | **Asked:** 0

The branch implements the approved /design/token-value value-view as the in-app Token
Usage screen (#2840). The loop hardened it from the committed restructure through to a
clean converged pass, verified by the live browser-check (visual gate) on the final HEAD.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 1 WARNING, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty at first review)
- [BLOCKER] web/index.html usageDonutSvg -- a single-model (100%) donut drew an invisible ring (360-degree arc with coincident endpoints, dropped by SVG) --> FIXED (draw a <circle>; regression test + browser-check ring-paint assertion) (b9d78ef2e)
- [WARNING] web/index.html hero/paintUsage/usageByModel -- blended grand total derived three times (Convention #5) --> FIXED (shared usageGrandTotal; test pins sum(usageByModel)===usageGrandTotal) (b9d78ef2e)
- [CONVENTION] .claude/plans/... -- plan said "awaiting A/B ruling" while code shipped REPLACE --> FIXED (recorded ruling A) (b9d78ef2e)
- [NIT] browser-check heroYears regex scanned whole hero text for "10" --> FIXED (read digit next to its label) (b9d78ef2e)
- [NIT] hero value "$0.0M" on light machines --> initially DEFERRED (exact-to-spec); properly FIXED at iteration 7

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 3 WARNINGs, 1 NIT
**Self-generated:** 0
- [WARNING] stale usageRowValue scope-note ("150B hero deliberately NOT brought in", now false) --> FIXED (d91628595)
- [WARNING] value-view grids keyed off viewport, not the fixed ~544px settings column (table+donut cramped) --> FIXED (#s-sec-usage is a size container; .tv-wtr stacks via @container; model-name ellipsis; browser-check measures real overflow) (d91628595)
- [WARNING] two-model-with-one-zero donut untested --> FIXED (test) (d91628595)
- [NIT] donut center treated grandTotal 0 as "absent" (fabricated 1) --> FIXED (d91628595)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** 0
- [WARNING] hero figure fonts used viewport clamps (80px) in the 544px column, so production-scale ($135.0M/150.0B) would clip under overflow:hidden --> FIXED (cqi fonts; browser-check re-mocks at 150B and asserts no clip) (bf072da4e)
- [WARNING] multi-slice donut arc geometry untested --> FIXED (60/40 test pins large-arc flags) (bf072da4e)
- [CONVENTION] plan file lacked the prescribed -<timestamp> suffix --> FIXED (renamed; gate matches by branch substring) (bf072da4e)
- [NIT] tokens >= 1e12 show "1500.0B" not a "T" band --> DEFERRED (design uses the B band; exact-to-spec)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 2 CONVENTIONs, 2 NITs
**Self-generated:** 0
- [WARNING] USAGE_MODEL_PRICES['claude-fable-5-1'].cr = 0.25 flagged as an outlier --> DEFERRED, verified CORRECT: re-fetched claude.com/pricing 2026-09-14 (Fable 5.1 cr=$0.25, legacy Fable 5 cr=$1.00); added an inline note so it is not "corrected" (90cd4cdd4)
- [CONVENTION] per-row 4-class total formula duplicated in usageByModel + usageHistoryHtml --> FIXED (shared usageRowTokenTotal) (90cd4cdd4)
- [CONVENTION] plan stale (17/17, charts4 "gated") --> FIXED (90cd4cdd4)
- [NIT] reEsc dead helper in test --> FIXED (removed) (90cd4cdd4)
- [NIT] sub-0.01-rad donut slice hairline gap --> DEFERRED (needs <0.16% slice; cosmetic)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 1 CONVENTION, 2 NITs
**Self-generated:** 0
- [CONVENTION] two comments (the #2617 "shown in full / combined chart / money box" preamble, and usageTotals' "DELIBERATELY never added together") contradicted the shipped blended-total hero --> FIXED (both rewritten to the shipped truth) (f2e9c0525)
- [NIT] "<0.1%"/"<1%" concatenated into innerHTML as literal "<" (invalid markup) --> FIXED (&lt;) (f2e9c0525)
- [NIT] "Human Work Hours" passed a raw float to usageAbbr --> FIXED (round; demo-scale unchanged) (f2e9c0525)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 1 WARNING
**Self-generated:** 0
- [WARNING] docs/browser-checks/README.md index entry described the removed pre-#2840 structure --> FIXED (updated to the shipped value-view; wiring guards green) (3fe41a4ba)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 1 WARNING, 1 NIT
**Self-generated:** 0
- [WARNING] hero "Approximate Human Cost" showed "$0.0M" for real sub-$1M figures (the iteration-1 deferred item, re-raised with demo-screen impact) --> FIXED (keep "$X.XM" verbatim >= $1M, fall back to usageUsd below; demo scale byte-identical; test added) (ce46f09a2)
- [NIT] donut center font-family via SVG presentation attribute (var() unreliable there) --> FIXED (moved into style) (ce46f09a2)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 3 NITs
**Self-generated:** 1 (the garbled comment below was written by iteration 2's commit)
- [WARNING] hero human-cost "$135.0M" (one decimal) vs API-cost "$74M" (whole) in one card --> DEFERRED, intentional: the mock locks "$135.0M" for the headline, the stat uses the general usageUsd formatter; documented at valueStr so it is not re-flagged (90ae81799)
- [NIT] plan test count stale (19/19) --> FIXED (20/20) (90ae81799)
- [NIT] SELF -- garbled "used by ruling" comment (from iteration 2) --> FIXED (smoothed) (90ae81799)
- [NIT] all-zero-token donut draws stacked slivers --> DEFERRED (reachable only with an all-zero /api/usage entry the recorder does not produce; no crash/NaN)

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKER/WARNING/CONVENTION, 1 NIT
**Self-generated:** 0
- [NIT] blended total read "150.0B" (hero) vs "150B" (donut center) for the identical number at showcase scale --> FIXED (shared usageBigTokens; test pins both show "150.0B") (221e634c3)

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0
**Converged** -- "No issues found"; zero new BLOCKER/WARNING/CONVENTION/NIT.

### Final Ledger (BLOCKER/WARNING/CONVENTION; NITs summarized above)

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web/index.html | BRANCH | single-model donut invisible ring | FIXED | b9d78ef2e |
| 2 | 1 | WARNING | web/index.html | BRANCH | grand total derived 3x (Conv #5) | FIXED | b9d78ef2e |
| 3 | 1 | CONVENTION | plan | BRANCH | plan contradicts shipped decision | FIXED | b9d78ef2e |
| 4 | 2 | WARNING | web/index.html | BRANCH | stale "150B not brought in" comment | FIXED | d91628595 |
| 5 | 2 | WARNING | web/index.html | BRANCH | grids keyed off viewport not 544px column | FIXED | d91628595 |
| 6 | 2 | WARNING | test | BRANCH | 2-model-with-zero donut untested | FIXED | d91628595 |
| 7 | 3 | WARNING | web/index.html | BRANCH | hero fonts clip at production scale | FIXED | bf072da4e |
| 8 | 3 | WARNING | web/index.html | BRANCH | multi-slice arc math untested | FIXED | bf072da4e |
| 9 | 3 | CONVENTION | plan | BRANCH | plan name lacked timestamp | FIXED | bf072da4e |
| 10 | 4 | WARNING | web/index.html | BRANCH | fable-5-1 cr price outlier | DEFERRED | verified correct vs claude.com/pricing; note added |
| 11 | 4 | CONVENTION | web/index.html | BRANCH | per-row total duplicated | FIXED | 90cd4cdd4 |
| 12 | 4 | CONVENTION | plan | BRANCH | plan stale (17/17, charts4 gated) | FIXED | 90cd4cdd4 |
| 13 | 5 | CONVENTION | web/index.html | BRANCH | two comments contradict blended hero | FIXED | f2e9c0525 |
| 14 | 6 | WARNING | README | BRANCH | index entry describes removed structure | FIXED | 3fe41a4ba |
| 15 | 7 | WARNING | web/index.html | BRANCH | hero value "$0.0M" for light machines | FIXED | ce46f09a2 |
| 16 | 8 | WARNING | web/index.html | BRANCH | hero vs API-cost decimal precision | DEFERRED | intentional (approved mock); documented |

### Deferred (with reasoning)
- Fable 5.1 cache-read $0.25: verified CORRECT against claude.com/pricing (2026-09-14); inline note added.
- Trillions "T" band: the approved design uses the B band; exact-to-spec ruling.
- Sub-0.01-rad donut slice hairline gap: needs a <0.16% slice; cosmetic; the zero-arc clamp is deliberate.
- All-zero-token donut: reachable only with an all-zero /api/usage entry the recorder does not produce; no crash/NaN.
- Hero "$X.XM" one-decimal vs API-cost whole-number M band: the approved mock locks "$135.0M"; documented.

### Strengths (recurring across iterations)
- Convention #5 single-source helpers (usageGrandTotal, usageRowTokenTotal, usageBigTokens) with a value-pinning test.
- XSS: every model-name innerHTML sink esc()'d; unpriced list via textContent; hostile-name tests.
- No-guess API cost (unpriced excluded + named; cost null -> dash, not false $0), source + date cited.
- Visual gate: browser-check measures real overflow at the 544px column and re-mocks at production scale.
