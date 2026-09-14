---
pre_challenge: true
method: challenge-loop
branch: token-value-2840
diff_hash: cee5458f3ace10d1d79933f9053a86b4dd8243e93651ec13d75a2aa5f5f08a69
validation: passed
subdir_audit: passed
timestamp: 2026-09-12T08:52:43Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 8 (0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 4 NITs)
**Fixed:** 4 | **Deferred:** 4 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0 (first reviewer pass; ITER_COMMITS empty, 6.0 baseline passed clean)
- [WARNING] web/index.html #usage-history — scrollable region not keyboard-reachable (no tabindex) --> FIXED (3189aea1): tabindex=0 + role/aria-label, the .pj-screen WCAG-AA pattern; browser-check asserts it.
- [WARNING] web/index.html usageTableHtml/usageHistoryHtml — two derivations of the same day+model row set (Convention #5) --> FIXED (3189aea1): added a test pinning both produce the same (day,model) set.
- [CONVENTION] .claude/plans/token-value-2840.md — em dashes --> FIXED (3189aea1).
- [NIT] plan .uhwrap vs as-built class names --> FIXED (3189aea1): corrected plan to as-built.
- [NIT] usageAbbr magnitude literals not SCREAMING_CASE --> DEFERRED: universal SI boundaries, not domain values; matches the design's abbr; covered by the doc comment + node test.

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Duplicates of prior findings:** 1 (the abbr-literals NIT, already deferred)
**Converged** — the sole WARNING deduplicates to the documented weakest-premise deferral; the rest are NITs.
- [WARNING] web/index.html usageHistoryHtml — the "Total tokens" column is a live per-row 4-class SUM (~99% cache_read), the same blend #2617 refuses for its headline, and unlike Value it is not stubbed --> DEFERRED: matches this branch's documented weakest premise (the plan defers the "never sum classes anywhere" reading to Josh's standing blend ruling). The reviewer itself classified it "documented deferral, surfacing not blocking." Mitigations in place: labeled "Total tokens" not a headline/dollar, the 4-class measurement table stays below it, a per-ROW breakdown is not the single blended headline #2617 rejects. Folded into the Josh blend ruling in the PR.
- [NIT] usageAbbr cross-band rounding (999.5K->"1000K", ~999.95M->"1000.0M") --> DEFERRED: cosmetic, narrow ranges, full number on the title hover, and it is the design's own abbr behavior.
- [NIT] usageAbbr literals --> DEFERRED (duplicate of iteration 1).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html #usage-history | BRANCH | scroll region not keyboard-reachable | FIXED | 3189aea1 |
| 2 | 1 | WARNING | web/index.html usageHistoryHtml/usageTableHtml | BRANCH | dup row derivation (Conv #5) | FIXED | 3189aea1 |
| 3 | 1 | CONVENTION | plans/token-value-2840.md | BRANCH | em dashes | FIXED | 3189aea1 |
| 4 | 1 | NIT | plans/token-value-2840.md | BRANCH | .uhwrap vs as-built names | FIXED | 3189aea1 |
| 5 | 1 | NIT | web/index.html usageAbbr | BRANCH | magnitude literals | DEFERRED | SI boundaries, doc-commented |
| 6 | 2 | WARNING | web/index.html usageHistoryHtml | BRANCH | Total column live blended sum | DEFERRED | documented weakest premise; Josh blend ruling |
| 7 | 2 | NIT | web/index.html usageAbbr | BRANCH | cross-band rounding cosmetic | DEFERRED | matches design; full number on hover |

### Outstanding questions (ASKED)
None. The blend-vs-output decision (which fills the Value stub and settles the Total-column reading) is a STANDING Josh ruling surfaced via Splinter, not an unresolved ASKED finding blocking this increment: the increment ships a defensible per-row breakdown with the contested $ stubbed, and Josh's ruling refines it as a follow-up.

### NITs (non-blocking)
- usageAbbr magnitude literals (iter 1).
- usageAbbr cross-band rounding cosmetic (iter 2).

### Strengths (across iterations)
- The Value stub is genuinely inert (a hardcoded constant, no live math path); no dollar can leak, double-guarded by the node test (!/\$/) and the browser-check (historyHasDollar===false, historyValueStubbed).
- Security clean: day + model esc()-escaped, hostile-model-name test confirms escaping.
- No-blend #2617 invariant preserved (per-row breakdown, not a blended headline; usageTotals untouched).
- Strong tests: hand-computed totals independent of the product formula, newest-first pinned, usageAbbr boundaries, empty case, the Convention-#5 same-row-set pin.
- a11y handled with reasoning (tabindex/role/aria); ordering mirrors usageTableHtml; clean lift with all deps; no em dashes in shipped output.
