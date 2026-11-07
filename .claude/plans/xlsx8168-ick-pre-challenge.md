---
pre_challenge: true
method: challenge-loop
branch: xlsx8168-ick
diff_hash: 6341bebeea7b76b3c02fe6d4430fbcaad9b4a0376bf30a145432db5b7ecb4f6c
validation: passed
subdir_audit: passed
timestamp: 2026-11-07T10:47:09Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iteration 6: no new BLOCKER, WARNING or CONVENTION)
**Total findings:** 12 WARNINGs, 0 BLOCKERs, 0 CONVENTIONs, plus NITs
**Fixed:** 11 | **Deferred:** 1 | **Asked (awaiting user):** 0

The baseline came from the card's own measurements: on main, W1 and W2 fail. Final validation (6j) passed on the converged head: 27893 tests, 0 fail, no leaks, hash 6341bebeea7b. The rebase onto origin/main touched no xlsx file and left that hash unchanged. After the rebase the xlsx, sheetpreview and reachable test files passed 91/91.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the comment claiming a lost `<sheet` counts)
- [WARNING] engine/xlsxpreview.js elements(): a lost start on the LAST item was not counted --> FIXED (b4671705eb)
- [WARNING] engine/xlsxpreview.js elements(): a near-miss moved the stray search past a stray close --> FIXED (b4671705eb: search from the last element's end)
- [WARNING] engine/xlsxpreview.js: the whole sheet list was held in memory (measured at 164 MB) --> FIXED (b4671705eb: only MAX_SHEETS held)
- [WARNING] self-closed lists (sheet, numFmt, Relationship, last xf): a lost start was invisible, and the comment and plan claimed otherwise --> FIXED (b4671705eb: list mode)
- [NIT] redundant beforeList term --> FIXED; wall-clock test --> FIXED later; xf start arithmetic --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the heap test)
- [WARNING] engine/xlsxpreview-8168.test.js: the heap assertion could not sample a synchronous read --> FIXED (eb0431dfc1: structural assertion)
- [WARNING] web/index.html pvSheetInto hides `cut` on the not-a-grid and empty paths --> DEFERRED: outside this reader change (web/index.html has its own gates); filed as #8188 and named in the plan
- [NIT] unused start --> FIXED; veryHidden counter --> FIXED

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 of the above (both regressions from iteration 1's containers)
- [WARNING] a rels part with its container lost read as empty --> FIXED (46f4e7763e: listItems falls back and counts)
- [WARNING] a styles part with `<numFmts>` lost showed a date as a bare number, said whole --> FIXED (46f4e7763e: undefined custom format counted)
- [NIT] si not in list mode --> named in the plan; test title --> FIXED; Excel-shaped fixture --> FIXED (test added)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 of the above
- [WARNING] the one-pass test could not fail without the cache --> FIXED (cd7d019e4f: 95,000 cells)
- [WARNING] one unused undefined format marked every sheet cut --> FIXED (cd7d019e4f: counted per cell)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] the missing-part not-a-grid path had no test --> FIXED (d065815d43)
- [NIT] listItems first-match residual --> named in the plan; lost kind simplified --> FIXED

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
**Converged:** no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/xlsxpreview.js elements | BRANCH | lost last start | FIXED | b4671705eb |
| 2 | 1 | WARNING | engine/xlsxpreview.js elements | BRANCH | near-miss hides stray | FIXED | b4671705eb |
| 3 | 1 | WARNING | engine/xlsxpreview.js readBook | BRANCH | whole sheet list held | FIXED | b4671705eb |
| 4 | 1 | WARNING | engine/xlsxpreview.js lists | SELF | self-closed lost start | FIXED | b4671705eb |
| 5 | 2 | WARNING | engine/xlsxpreview-8168.test.js | SELF | heap test cannot sample | FIXED | eb0431dfc1 |
| 6 | 2 | WARNING | web/index.html pvSheetInto | BRANCH | cut hidden on two paths | DEFERRED | #8188 |
| 7 | 3 | WARNING | engine/xlsxpreview.js listItems | SELF | lost rels container read as empty | FIXED | 46f4e7763e |
| 8 | 3 | WARNING | engine/xlsxpreview.js styleKinds | SELF | lost numFmts, bare number said whole | FIXED | 46f4e7763e |
| 9 | 4 | WARNING | engine/xlsxpreview-8168.test.js | SELF | cache test cannot fail | FIXED | cd7d019e4f |
| 10 | 4 | WARNING | engine/xlsxpreview.js styleKinds | SELF | unused lost format cuts all | FIXED | cd7d019e4f |
| 11 | 5 | WARNING | engine/xlsxpreview.js readBook | BRANCH | missing-part path untested | FIXED | d065815d43 |

### Mutants

Each fix was removed in turn and a test failed for each one:
- no structureBeforeStrings
- no nearMiss
- no stray-close count (si, c, row each alone)
- no list mode at each of the four sites
- no check after the last item
- stray search from the scan point
- no MAX_SHEETS cap
- no count, or no fallback read, for a lost container
- no lost-format check
- numFmt read from the whole styles part
- no per-cell lost count
- a hard false on the missing-part path
- no cached close search

### NITs (non-blocking, across all iterations)
- `[>100]0;[<=100]0.0` still reads as cut (the card's NIT)
- si is not in list mode (an `<sst>` may hold extLst)
- listItems decides a lost container from the first `<item` match
- an unclosed `<numFmts>` is counted as cut for the wrong reason (the result is still right)
- the corpus of real fixtures is openpyxl only; Excel 365 is covered by a hand-built test

### Strengths (across all iterations)
- Every stray-close and gap scan is linear, measured on hostile 12 to 16 MB parts
- Reading numFmt only inside numFmts fixes a real bug on main (a dxf format overwrote a cell format)
- Every new test carries a control that can fail
