---
pre_challenge: true
method: challenge-loop
branch: roomhold2-7654
diff_hash: 941d49ec3d392ff45f71a1fda9c2122c485a71bfc1df57e4b079214820bc5118
validation: passed
subdir_audit: passed
timestamp: 2026-11-01T01:49:10Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4. **Converged:** yes, round 4 found nothing actionable.
**Validation:** passed (REAL_EXIT=0, 20:44 CDT). Rebased onto main after it; LogicTests and typechecks above re-run clean.
**UI:** Release build and 18 room and DM checks on iOS 27 and 26.5 before round 3; RoomOpensAtNewestUITests 5/5 on both after it.

## Iteration 1
- [WARNING] (fixed) a Post, new-post or working-line jump inside the 1.5 s hold window was fought by the hold's put-back: toEnd and toRow change the moves key.
- [WARNING] (fixed) the known XCTExpectFailure block was dead; deleted, comment corrected.
- [WARNING] (stated in the plan) only keyboard checks measured the jump paths moved onto toEnd/toRow.

## Iteration 2
- [WARNING] (fixed) the room's id anchor now runs only from iOS 26, where the hold runs and it was measured.
- [NIT] (fixed) tokens on two queued steps.

## Iteration 3
- [WARNING] (fixed) the early-scroll check could not fail on iOS 26; a second one runs with the anchor off, which guards the cancel. Its control is round 3's, not re-run.
- [NIT] (fixed) the keyboard's jump counts as the app's move.
- [NIT] (accepted, in the plan) after toRow the anchor stays nil until SwiftUI writes the position back.

## Iteration 4
No new actionable findings.

## Weakest premise
That the jump paths behave off the keyboard: only keyboard checks measured them.
