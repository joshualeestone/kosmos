---
pre_challenge: true
method: challenge-loop
branch: metr-footnote-2840
diff_hash: 9c130ac1b6425e559680cec6914ad1e4ce45789b8de1b253284c20a93fe38315
validation: passed
subdir_audit: passed
timestamp: 2026-09-13T18:26:52Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4 found zero BLOCKER/WARNING/CONVENTION)
**Total findings:** 10 (0 BLOCKERs, 1 WARNING, 1 CONVENTION, 8 NITs)
**Fixed:** 7 | **Deferred:** 3 | **Asked (awaiting user):** 0

The footnote CODE itself drew zero BLOCKER/WARNING across all four passes (two models). Every
actionable finding was about sharpening the render check's discrimination; the code was clean
from iteration 1. Both gates are green: 6j node validation exit 0, and the full page-layer
harness (tools/browser-checks.sh) exit 0 with render-token-usage-2617 PASS on all 13 footnote
assertions.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 (ITER_COMMITS empty during this review; 6.0 passed so first reviewer is iter 1)
- [NIT] render-token-usage-2617.js — "leads with" message vs a presence-only regex --> FIXED (f6c8aa77): anchored /^how we estimate the value/i
- [NIT] render-token-usage-2617.js — borderTopW>=1 can't tell a hairline from a thick border; radius unasserted --> FIXED (f6c8aa77): assert exactly 1px + no radius
- [NIT] web/index.html — footnote adjacency above the money box could invite associating the blended note with the output figure --> addressed in iter 3 via a before-money assertion (37a5aa65)
- [NIT] docs/browser-checks/README.md — the check's README row not extended for the footnote --> DEFERRED: pre-existing (the row never mentioned #2840's earlier history-list additions either); a README refresh is a separate hygiene task, out of scope for this footnote PR

#### Iteration 2
**Reviewer model:** sonnet (different model from iter 1)
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 1 (the box-shadow finding is about the assertion block iter 1 added; a code fix, not a prose claim)
- [WARNING] render-token-usage-2617.js — a callout drawn with box-shadow (inset box / shadow left-rule) would produce borderLeftW=0/maxRadius=0/transparent-bg and FALSELY pass --> FIXED (0a95747c): assert box-shadow is none too
- [NIT] web/index.html — link color = text color, distinguished by underline only --> DEFERRED: WCAG 1.4.1-compliant (underline), matches the codebase's .linkish muted-link idiom, and a muted link is the correct QUIET choice for this footnote

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 1 (findings touch the assertion block iter 1-2 added; code fixes)
- [CONVENTION] render-token-usage-2617.js — copy asserted by substrings, not the full string; a dropped/garbled link text would pass --> FIXED (37a5aa65) for the concrete gap: assert the link anchor text names METR. The FULL exact-string pinning is DEFERRED: copy is owner-owned and reversible (Josh eyeballs in-app; Mona owns wording), so a wording tweak should not red a structural render check
- [NIT] render-token-usage-2617.js — after-hist/before-meas can't tell "under history" from "below the money box" (the money box is in that gap) --> FIXED (37a5aa65): assert the footnote precedes #usage-worth, pinning Mona's exact placement
- [NIT] render-token-usage-2617.js — an outline-drawn callout would evade all five style checks --> DEFERRED: exotic, not the design's .method mechanism; blocklisting ever-more-exotic properties (outline, background-image, clip-path...) is an unbounded target-moving that does not improve real coverage (bulletin a-loop-can-converge-on-a-target-you-keep-moving)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 1 (the shadowing var is on the line iter 3 added)
**Converged** — no new actionable findings. Reviewer confirmed: placement assertions query static containers (no async race), null-guards correct, the bg check accepts both rgba(0,0,0,0) and transparent (no false-red), rel=noopener present, matches the plan, no em dashes (all five spellings).
- [NIT] render-token-usage-2617.js — inner `const money` shadows an outer `money` (different selector) --> FIXED (74a8e50a): renamed to moneyBox (pure rename, verified by the final harness)

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | NIT | render-token-usage-2617.js | BRANCH | leads-with regex presence-only | FIXED | f6c8aa77 |
| 2 | 1 | NIT | render-token-usage-2617.js | BRANCH | hairline thickness + radius unasserted | FIXED | f6c8aa77 |
| 3 | 1 | NIT | web/index.html | BRANCH | footnote adjacency to money box | FIXED | 37a5aa65 |
| 4 | 1 | NIT | README.md | BRANCH | check README row not extended | DEFERRED | pre-existing, out of scope |
| 5 | 2 | WARNING | render-token-usage-2617.js | SELF | box-shadow callout blind spot | FIXED | 0a95747c |
| 6 | 2 | NIT | web/index.html | BRANCH | link color = text (underline only) | DEFERRED | WCAG-ok, matches .linkish idiom |
| 7 | 3 | CONVENTION | render-token-usage-2617.js | SELF | not full exact copy | FIXED (link text) + DEFER (full string) | 37a5aa65 |
| 8 | 3 | NIT | render-token-usage-2617.js | SELF | placement granularity | FIXED | 37a5aa65 |
| 9 | 3 | NIT | render-token-usage-2617.js | BRANCH | outline callout gap | DEFERRED | exotic, target-moving |
| 10 | 4 | NIT | render-token-usage-2617.js | SELF | var shadowing | FIXED | 74a8e50a |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, deferred)
- [NIT] README.md — the check's README row was not extended (pre-existing pattern; separate hygiene task)
- [NIT] web/index.html — the METR link shares the muted text color, distinguished by underline (WCAG-compliant, matches the .linkish idiom, correct quiet choice)
- [NIT] render-token-usage-2617.js — an outline-drawn callout is not asserted against (exotic; the five style assertions cover the design's actual mechanisms)

### Strengths (across all iterations)
- Accessibility solid: --k-ink-2 on the page ground measures ~7.8:1 (light) / ~8.6:1 (dark) / ~7.3:1 (midnight), all past WCAG AA; link distinguished by underline (not color alone) with meaningful text ("METR's research"); target="_blank" carries rel="noopener" (iterations 1, 2, 3, 4)
- The render check genuinely discriminates and nothing is vacuous: v.method is null-guarded so a MISSING footnote reds; the exact-URL/link-text/copy/1px-hairline/no-left-rule/no-radius/no-bg/no-box-shadow/placement assertions each red a real defect; placement queries static containers so there is no async-paint race (iterations 1, 2, 3, 4)
- Purely additive scope: one CSS rule pair + one `<p>` + the check assertions; nothing else in the token-usage section touched; no em dashes in any spelling (iterations 1, 2, 3, 4)
