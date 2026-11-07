---
pre_challenge: true
method: challenge-loop
branch: unmark-8158
diff_hash: 96135d948536da7759245bfe200ebbccff4405c235d50c735431854d3d3fb3a0
validation: passed
subdir_audit: passed
timestamp: 2026-11-07T06:57:24Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8, the fleet's standing cap (no BLOCKER open).
**Converged:** No: stopped at the cap. Round 8 had no blocker and its one new warning is left, below.
**Total findings:** 0 BLOCKERs, 21 WARNINGs, 1 CONVENTION, 27 NITs, counted from the rounds below.
**Validation:** focused, not the full suite. `render-tasks-view-3559` and `render-subprojects-1994` pass on the final code before the last rebase; the node set of 5 files, 53 tests, passes after it. Four design shots on the commit before round 7's edits, 0 tap failures. CI runs the rest.
**Origin column:** 6c-bis's blame lookup was not run.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] Undo under the 44px phone tap target --> FIXED
- [WARNING] the check could not catch that --> FIXED
- [WARNING] the shot showed only the easiest row --> FIXED
- [NIT] comment placement, cleanup status, verify --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] new screen split a neighbour's comment --> FIXED
- [WARNING] screen assumes tasks 1 and 2 --> DEFERRED: as project-built does; a miss throws a named error
- [WARNING] spoken wording --> DEFERRED: the design call on the card

#### Iteration 3
**Reviewer model:** opus
- [WARNING] the "agent's note" row was marked by the person --> FIXED: marked from outside the page
- [NIT] edge-tap coverage, cleanup of both tasks --> FIXED; the rest left

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] fixture assumption --> duplicate of round 2
- [WARNING] after may be skipped --> DEFERRED: the runner calls it whatever happened, read at the runner
- [CONVENTION] does the target selector match --> answered: passed in the run

Then Mona Lisa's call: after a note, Undo starts its own line. The screen's verify caught the phone rule losing on specificity --> FIXED.

#### Iteration 5
**Reviewer model:** opus
- [WARNING] Undo above "Saved as change" --> FIXED: Mona Lisa's call, the commit line goes first
- [WARNING] no regular check of the touch rule --> FIXED
- [WARNING] no regular check that a plain row stays inline --> left: only the by-hand verify
- [WARNING] shots lack a named agent's and a Needs Your Decision row --> left: a named mark needs a token

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] the outside POST may be refused --> DEFERRED: it returned 200, the shots exist
- [WARNING] plain row check --> duplicate of round 5
- [WARNING] a stretched button would make the line a target --> FIXED: the check measures width

#### Iteration 7
**Reviewer model:** opus
- [WARNING] Undo also removes the commit line, backing the misreading --> FIXED: the message says the saved change is not touched
- [WARNING] nothing guards the new order --> FIXED: a test that fails on the old order, proven
- [WARNING] the outside mark leaves history --> DEFERRED: on the screen tool's throwaway board

#### Iteration 8
**Reviewer model:** sonnet
- [WARNING] verify's geometry could false-red if a plain row wraps --> left: it is loud and run by hand
- [WARNING] Undo alone on its line names no object --> duplicate: named in the plan, the design call
- [NITs] specificity coupling, range assumption, best-effort sentence --> left

### Outstanding questions (ASKED)
None.

### Also
The branch was squashed: 13 commits conflicted repeatedly with #8137 on the same lines. Resolved once, keeping both changes; #8137's tests pass.

### Strengths
- Label in name holds. Checks were proven able to fail: the design screen's caught a real bug.
