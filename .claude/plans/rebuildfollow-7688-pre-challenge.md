---
pre_challenge: true
method: challenge-loop
branch: rebuildfollow-7688
diff_hash: 31b28a38ec33b8b38f024121218445ebc27089e7ef1f2992e97536a637c62e60
validation: passed
subdir_audit: passed
timestamp: 2026-10-31T23:58:17Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2. **Converged:** yes, at round 2.
**Validation:** passed (REAL_EXIT=0, AUDIT_EXIT=0, 18:52 CDT) on the branch rebased onto #7692. Rebased onto current main again after
that; iOS LogicTests and every ios/LogicTests run-*.sh green, Debug and Release typechecks clean.
**UI:** Release build and 14 checks on iOS 27 and 26.5 passed BEFORE the rebase onto #7692 (16:08). Rebasing moved the hook onto
sampleRebuild, with its count marker kept. That has not been re-run here; CI's ui tests run all 7 KeyboardSlide checks and decide it.

## Iteration 1
- [WARNING] (fixed) "redrawn" was not a true claim: onScreen counts rows SwiftUI said appeared, which can be true over a black list. It says rebuilt.
- [WARNING] (fixed) the delayed report could land on another chat: only for the same chat on screen.
- [WARNING] (fixed) the debug rebuild could run under a finger and not rebuild: it waits for the finger to lift.

## Iteration 2
- [WARNING] (fixed) a report skipped by leaving the chat never came back: it re-arms.
- [NIT] (fixed) a trace when the hook runs while scrolling; one name for the grace.
No BLOCKER. Converged.

## Weakest premise
Plan item 3: a rebuilt list whose scroll view is not found again gets no further recovery. Decided, seen once as a half laid-out read,
never as a list left blank. Revisit on a shared report showing no scroll view with no rows.
