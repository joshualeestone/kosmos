---
pre_challenge: true
method: challenge-loop
branch: iostasks-7031
diff_hash: 11518e905af01e6352e89dc32f1995a805ecd0b2a91913491e082c8ad8b096aa
validation: passed
subdir_audit: passed
timestamp: 2026-10-24T19:56:41Z
iterations: 2
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 blind reviews: a design review (Mona Lisa, 07:58 CDT) and code review 1 (sonnet, 09:53 CDT). **Converged: no**: code review 1's fixes, and the rebase onto main (52 commits, #7032 native Projects), were not reviewed again. Every finding and decision is in .claude/plans/iostasks-7031.md.

**Validation of THIS diff:** the Mortals full suite on head 2e28cdba56 (base d5649b5f8a): passed, hash 11518e905af0, which is this proof's diff_hash (computed with the gate's own command, never typed). The iOS logic suites, run locally on the same head: run.sh 1065/1065, run-tasks 90/90, run-settings 41/41, run-actions 97/97, run-room 119/119. The app builds (xcodebuild, simulator SDK, Debug).

**Earlier validations, stated exactly:** 54f991d15c passed 23784/0 before code review 1; 1765c490fd and d3b7229019 passed after it, both before the rebase. All three are superseded by the run above.

### Per-Iteration Breakdown

#### Iteration 1: design review
**Reviewer:** Mona Lisa
- [FIX] at the largest text the group dot rested on the baseline and read as a full stop --> FIXED (centred on the first line at every size)
- [CHECK] the end of the list clears the floating tab bar --> shut: PASSED (about 20 pt above the bar). Open: the shot sat flush. Diagnosed as the Debug sample scroll stopping short of the true end; the sample now scrolls to the list's real end. Retake pending; if it is still flush at the true end, the open case gets the shut gap.

#### Iteration 2: code review 1
**Reviewer model:** sonnet. 0 BLOCKER, 7 WARNING, all taken.
- [WARNING] W1 run-tasks.sh was not wired into CI, though the plan said so --> FIXED (ios.yml step, VERDICT grep)
- [WARNING] W2 a row's lines did not stack as tskRow stacks them --> FIXED
- [WARNING] W3 ready-to-check line not appended --> FIXED
- [WARNING] W4 subtasks did not nest --> FIXED in logic (Tasks.nest, tests) and view (indent, "Part of" crumb, spoken); five board-only row lines left out on purpose, DECIDED in the plan
- [WARNING] W5 a picked project that left the read kept an empty list --> FIXED (back to All projects)
- [WARNING] W6 a lost read carried the old Mac's layout over --> FIXED (layout and project reset)
- [WARNING] W7 "Pull down to try again" was not pullable --> FIXED (refreshable scroll view)
- [NIT] a duplicate request builder --> FIXED

### Not reviewed again (named so nobody reads this as converged)
- The rebase resolutions: the board's Tasks section now shows under Today (Projects is native too), AppTabs.follow is inert and swept by a test instead of a control (a mutant turns it red by name), and run-room.sh compiles TasksLogic.swift.
- The Debug-only sample scroll changes.
