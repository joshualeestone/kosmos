---
pre_challenge: true
method: challenge-loop
branch: builtwait-9011
diff_hash: 295a31a50adba7bcbda109355ffee3adebb204811ee0cd133794cae0e5941cf3
validation: failed (3 tests, none this branch's; see Validation below)
subdir_audit: passed
timestamp: 2026-11-25T00:51:18Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 blind review rounds (Opus, then Sonnet).
**Converged:** Yes. Round 2 raised no BLOCKER, WARNING or CONVENTION; its NITs needed no change.
**Total actionable findings:** 0 BLOCKERs, 3 WARNINGs, plus NITs
**Fixed:** 3 | **Declined:** 0 | **Asked:** 0

## Validation
- Final validation (before the rebase onto main 3efef4f541's base; this branch merges clean): 30966 tests, 3 failures:
  - `#185: the room store refuses an agent-authored row with no command provenance` (engine/messages.test.js): fails on
    main on this Mac too. The test's "nobody's pane" `%99` is a real pane here (tmux: `april-discord %99`), so it
    resolves to a real agent; CI has no such pane. Measured on main aad295cc74 and the base dc90a4686e. Angel is fixing
    the test id on #8988's branch.
  - `a fresh download sweeps other versions' leftovers` and `cancel while the part-file open is still queued leaves
    nothing behind (#458)` (engine/connect.test.js): "expected to still be queued behind the saturated pool", a load
    assertion. engine/connect.test.js alone: 110 pass, 0 fail (1 skipped), twice.
  - This branch changes engine/projects.js, web/index.html (pjPillOf), the iPhone project word and tests; none of the
    three. Judged not this branch; CI is the next witness.
- After the rebase onto current main (3efef4f541): engine/builtwaiting-9011.test.js and the 1303e and 6483 pill tests 17/0;
  ios/LogicTests/run-room.sh 964/964; render-projects-badges-4730.js 85 passed, 0 failed. Before it: web*.test.js
  3857/3857, ios/LogicTests/run.sh 2305/2305, every run-*.sh, the app builds for the simulator.
- Subdir audit: rc 0.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, NITs
- [WARNING] the iPhone project list mirrors pjPillOf and would disagree --> FIXED (BoardRoom.projectWord, ProjectsView, room tests)
- [WARNING] the comment said the pill sits under #4730; it bends #4730 as Paused does --> FIXED (said plainly, plan's weakest premise)
- [WARNING] comments said every built task waits on the person; some wait on a release --> FIXED
- [NIT] parent and subtasks counted separately --> NOTED in the comment (only > 0 is read)
- [NIT] paused project and an agent's hold for the person untested --> FIXED (test added)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, NITs only (all confirmations; no change needed)

## Residuals
- It bends Josh's #4730 ("a badge only when something is actually running") as Paused does. If he reads #4730 strictly,
  it is one pjPillOf line and its Swift mirror to remove.
