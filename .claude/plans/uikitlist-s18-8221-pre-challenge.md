---
pre_challenge: true
method: challenge-loop
branch: uikitlist-s18-8221
diff_hash: 276a2b3c5778eb15737975bcde863051e98fcb8674aa73a3475c1ae90080ad97
validation: passed
subdir_audit: passed
timestamp: 2026-11-10T23:13:50Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 found NITs only)
**Total findings acted on:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, plus NITs
**Fixed:** 2 WARNINGs, 2 NITs | **Deferred:** 0 | **Asked:** 0

Rebased onto main after review (a conflict in ios/tools/ui-sample.sh's UIKit class list, where slice 16 had added its
classes: resolved to main's line with A11yFocusUITests 12 -> 14). The +/- lines of the Swift and plan diff are identical
before and after; only file ids and line numbers moved. Full run-tests validation passed on the rebased branch (hash
276a2b3c5778). Commit ids below are from before that rebase.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] ios/Kosmos/ChatList.swift:649,672 - one switch removed both rules, so the newest control was specific to its rule only through the synthetic element's height --> FIXED (e3fab74e1d): one switch per rule (KOSMOS_SAMPLE_FOCUSNONEWEST, KOSMOS_SAMPLE_FOCUSNOONSCREEN)
- [WARNING] ios/KosmosUITests/A11yFocusUITests.swift:65 - the newest control's disjunction left a thin margin --> FIXED (e3fab74e1d): asserts the reader left the newest
- [NIT] test wording "tall newest message" --> FIXED (comment says an element taller than the screen); UI-NOTE label and visible control's kind check --> noted
- The plan's "Limit" line was wrong (the newest mode focuses a synthetic element twice the list's height) --> FIXED (e3fab74e1d)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0
- [NIT] comment cited "(review 1)" --> FIXED (bef7c51c4f)
- [NIT] sampleA11yFocus doc, UI-NOTE label, visible control could also assert !atEnd, class header --> noted
**Converged** - no new actionable findings.

### Final Ledger (WARNINGs and above)

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | ChatList.swift:649,672 | BRANCH | one switch removed both rules | FIXED | e3fab74e1d |
| 2 | 1 | WARNING | A11yFocusUITests.swift:65 | BRANCH | newest control's disjunction | FIXED | e3fab74e1d |

### NITs (non-blocking, across all iterations)
- the UI-NOTE line says "slice 12" for the new controls (the switch name tells them apart)
- the visible control asserts moved != 0 only (measured 93)

### Strengths (across all iterations)
- Release and an unset Debug build are unchanged (both switches fold to the original conditions)
- Each control removes exactly its rule, uses the same mode as its paired check, and inverts that check's assertion
- Measured: visible without the on-screen rule moved 93 and left the newest; newest without the newest rule moved 26 and left the newest; with the rules on, both read moved 0 at the newest (3 runs, 14 of 14 each)
