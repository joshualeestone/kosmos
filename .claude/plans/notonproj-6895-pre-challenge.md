---
pre_challenge: true
method: challenge-loop
branch: notonproj-6895
diff_hash: f800058ef0b967d1525b0425ae79f205c9f8c1b51783185f1c6de7b04f8ba315
validation: passed (Mortals, full suite, clean entry 2026-10-22T13:06:28Z, base ee09338265; browser-check gates met by trailers)
subdir_audit: passed
timestamp: 2026-10-22T13:06:40Z
iterations: 9
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 9, blind, alternating opus and sonnet
**Converged:** Yes (iteration 9: its one WARNING deferred with evidence; no NEW findings)
**Total findings:** 0 BLOCKERs, 15 WARNINGs, 0 CONVENTIONs that needed action, plus NITs
**Fixed:** 10 | **Deferred:** 5 | **Asked (awaiting user):** 0
**Final validation (6j):** the first run (68b5c1acb) FAILED on fixture-discipline.test.js (the new test hand-built member
rows); fixed by taking rows from projects.describe. The last run (feb75bd858) is clean with this diff's hash.

Ledger: ~/.cache/claude-handoffs/baron-jobs/ledger-notonproj-6895.md.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 3 WARNINGs
**Self-generated:** 0
- [WARNING] engine/tasks.js: a closed task with an open part got offProject --> FIXED (progressOf guard; test red without it)
- [WARNING] web/index.html: the task page marked a closed task --> FIXED
- [WARNING] web/index.html: the count borrowed the empty-state style --> FIXED (.pj-offproject)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs
**Self-generated:** 1
- [WARNING] the claim line and notification name stay unlabelled --> DEFERRED: beside the labelled row; a notification is an event (plan)
- [WARNING] the count's legacy one-holder branch untested --> FIXED (test, red-checked)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 WARNING
**Self-generated:** 1
- [WARNING] the task page's finished-task rule untested --> FIXED (real paintTaskPage test, red-checked)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 1 WARNING
**Self-generated:** 0
- [WARNING] the close-note names the holder unlabelled --> DEFERRED: the premise of a warning beside the labelled row (plan)

#### 6j failure (between 4 and 5)
- [BLOCKER] final-validation: fixture-discipline.test.js refused hand-built member rows --> FIXED (rows from projects.describe; web.task-repeat-4787.test.js back to main's)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 3 WARNINGs
**Self-generated:** 1
- [WARNING] the plan claimed the 4787 test uses the object shape --> FIXED
- [WARNING] two derivations of membership --> DEFERRED: they agree because projects.describe emits one row per stored member (the test's pre-control asserts it); a route field was rejected for this slice (plan)
- [WARNING] an inherited owner is never labelled --> DEFERRED: treeOwners and ownerIn already keep members only (plan)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 1 WARNING
**Self-generated:** 1
- [WARNING] the plan named a mechanism replaced in iteration 5 --> FIXED (the claim deleted; the plan cites the tests)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 1 WARNING
**Self-generated:** 0
- [WARNING] a visible change with no design shots --> FIXED (/design-shots; two screens added to mobile-shots.js; posted on #6895 for Mona Lisa)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs
**Self-generated:** 2
- [WARNING] the shot screens could not fully undo removing a seeded member --> FIXED (a throwaway project, deleted after)
- [WARNING] the task screen assumed the first card's holder --> FIXED (clicks the labelled card)

#### Iteration 9
**Reviewer model:** opus
**New findings:** 1 WARNING (deferred), NITs
**Self-generated:** 1
- [WARNING] the throwaway project's joined/left pane lines are not undone --> DEFERRED: the shot board's tmux (test-support/fake-tmux.sh) swallows writes and serves capture-pane from a fixed file, so no shot can show a typed line; instructions return when the project is deleted
**Converged** - no new actionable findings.

### Checks
- Tests: engine/tasks.offproject-6895.test.js (3), web.notonproject-6895.test.js (5), each red against main's code; 199 tests across the 17 related files pass; fixture-discipline, engine.reachable, windows-coupling-audit-1732, windows-tests-1777 pass.
- Browser checks render-onhold-4771, render-alltasks, render-subtasks-3861 pass on the final web/index.html (trailer).
- Design shots: ~/work/design-shots/kosmos-6895/ at feb75bd858, 12 shots, 0 errors.

### Strengths (across all iterations)
- One rule on every surface: only open parts of an open task count; each surface has a finished-task control.
- #6896 found and fixed in passing: the reviewer choice read the page's member objects as names.
