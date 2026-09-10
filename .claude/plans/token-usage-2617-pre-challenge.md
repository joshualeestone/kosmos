---
pre_challenge: true
method: challenge-loop
branch: token-usage-2617
diff_hash: 505872126a6e433454c7922f710c7bb36f4a4231a299411ece501d850b0d0dcd
validation: passed
subdir_audit: passed
timestamp: 2026-09-10T07:28:41Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 produced zero BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 6 (0 BLOCKERs, 1 WARNING, 2 CONVENTIONs, 3 NITs acted-on) + deferred NITs
**Fixed:** 6 | **Deferred:** 3 (NITs) | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 2 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above (ITER_COMMITS empty; 6.0 passed clean, so nothing had committed yet)
- [CONVENTION] web/index.html:1854 — scrollbar-padding comment stale after #2617 inverted DOM order (money box now above the table) --> FIXED (72623c0f)
- [CONVENTION] web/index.html (legend HTML + usageChartSvg array) — four class colors duplicated across two surfaces ("two derivations of one fact") --> FIXED (72623c0f): single-sourced in USAGE_CLASS_COLORS driving chart + a JS-rendered legend
- [NIT] money copy "8-hour" vs mockup "eight-hour" --> DEFERRED: deriving from the constant avoids a stale-claim defect; Mona to rule on spelling in the headed/copy pass

#### Iteration 2
**Reviewer model:** sonnet (different model from iteration 1, per 6a)
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (all cited lines authored by the pre-loop build commit f87fc9ca, not by ITER_COMMITS 72623c0f)
**Duplicates of prior findings:** 0
- [WARNING] web/index.html:1887 — the cache-read CARD accent was a third, unlinked copy of the class color (read app-wide --gold, not USAGE_CLASS_COLORS) --> FIXED (acd36fb1): card accent now applied inline from USAGE_CLASS_COLORS; the --gold CSS rule removed; node test asserts equality
- [NIT] chart aria-label dropped the day count --> FIXED (acd36fb1): derived ", N days" from the series length
- [NIT] dead CSS `.usage-money:empty` --> FIXED (acd36fb1): removed
- [NIT] usageTableHtml (the innerHTML/escaping site) had no node coverage --> FIXED (acd36fb1): added a row-count + hostile-model-name escaping test

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Converged** — no new actionable findings.
- [NIT] money-box gold (rgba(214,166,46,.06) + --gold) is a fourth place #d6a62e lives --> DEFERRED: it is the app BRAND/money gold, a different semantic role from the cache-read CLASS color; forcing it to track USAGE_CLASS_COLORS would conflate two distinct meanings (reviewer agreed defensible). The stated single-sourcing goal (chart + legend + card accent) is met by reference.
- [NIT] x-axis labels even indices only, so the last (most recent) day is unlabeled for even point counts --> DEFERRED: matches Mona's mockup exactly (every other day; the mockup's 14th day is also unlabeled).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | CONVENTION | web/index.html:1854 | BRANCH | Stale scrollbar-padding comment (DOM order inverted by #2617) | FIXED | 72623c0f |
| 2 | 1 | CONVENTION | web/index.html:legend+chart | BRANCH | Four class colors duplicated across legend HTML + chart array | FIXED | 72623c0f |
| 3 | 1 | NIT | web/index.html:money copy | BRANCH | "8-hour" vs mockup "eight-hour" | DEFERRED | Derived from constant avoids stale claim; Mona rules on copy |
| 4 | 2 | WARNING | web/index.html:1887 | BRANCH | Card gold was a third unlinked copy of the class color (--gold) | FIXED | acd36fb1 |
| 5 | 2 | NIT | web/index.html:aria-label | BRANCH | Chart aria-label dropped the day count | FIXED | acd36fb1 |
| 6 | 2 | NIT | web/index.html:usage-money:empty | BRANCH | Dead CSS selector | FIXED | acd36fb1 |
| 7 | 2 | NIT | web.token-usage-2617.test.js | BRANCH | usageTableHtml (innerHTML site) had no node coverage | FIXED | acd36fb1 |
| 8 | 3 | NIT | web/index.html:money gold | BRANCH | Fourth place #d6a62e lives (brand gold) | DEFERRED | Brand/money gold is a distinct semantic role from the class color |
| 9 | 3 | NIT | web/index.html:chart labels | BRANCH | Even-index labels leave the last day unlabeled | DEFERRED | Matches Mona's mockup labeling exactly |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] money copy "8-hour" vs mockup "eight-hour" (iteration 1) — deferred to Mona's copy eyeball on the headed pass.
- [NIT] money-box brand gold is a fourth #d6a62e literal (iteration 3) — deferred; distinct semantic role.
- [NIT] x-axis labels even indices only, last day unlabeled (iteration 3) — deferred; matches the mockup.

### Strengths (across all iterations)
- The node test lifts the real render functions and pins the four class sums + the $1,559 dollar figure against hand-computed values independent of the product formula (the #2620 lesson), including a hostile-model-name escaping assertion for the innerHTML table site.
- Determinism of the browser-check (mocked /api/usage fixture; exactly four polylines; cache-read deterministically touches the top of the shared axis) and correct reason-grep count bumps (SITES 80->82, CATCH_SITES 49->51), verified by running the real counting logic.
- paintUsageWorth removed cleanly (no dangling refs); every empty/error branch clears all five containers so no stale render persists; divide-by-zero, empty-output, and <2-point edge cases all guarded and tested both directions.
- Color single-sourcing is genuine across all three JS-driven surfaces (chart line, legend swatch, card accent) by reference, confirmed by running the lifted functions.
