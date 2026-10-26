---
pre_challenge: true
method: challenge-loop
branch: staletasks-7151
diff_hash: 5bc0de89521f8fb89ef699d9b55d67d944f164c80519a3b727efb2b261fc123b
validation: passed (full validation_log_run_or_skip, run locally on this Mac at 660cfbe000, EXIT=0, "validation PASSED for stack=typescript hash=5bc0de89521f", shell part 4-wide per #7140; plus engine/tasks.leftunder-7151.test.js 20/20, server.tasks-leftunder-7151.test.js 3/3, the 18 task suites 181/181, fixture-discipline and no-name-refs. The branch merges cleanly onto current main (git merge-tree, 2026-10-26T00:04:33Z). Broken-copy controls each round red (listed in .claude/plans/staletasks-7151.md).)
subdir_audit: not run (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-26T00:04:33Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8, one fresh blind reviewer at a time. **Stopped at the 8-round cap**, not converged by a clean round:
round 8 found one warning, fixed here without a ninth review.
**Trend:** no blockers since round 3; findings per round 12, 8, 8, 6, 4, 4, 6, 3.
**Asked (awaiting user):** 0
**Split out:** none.

#### Iteration 1
3 blockers, 5 warnings, 4 nits, all fixed by a stricter rule. Blockers: repeating tasks offered; an unreadable roster offered everything; the waiting check had no real test (now real fleet cards with a control). Warnings: a project in two records; a replaced parent read as finished; person-set fields ignored; a walk past an open parent; re-parenting invisible.

#### Iteration 2
1 blocker, 3 warnings, 4 nits. Blocker fixed: the history check became an allow-list of rows only an agent writes, naming itself, tested against the engine's own writers. Warnings: every task above the parent must be finished; an empty or unreadable history is not "never touched"; the line speaks to the task's owner.

#### Iteration 3
0 blockers, 5 warnings, 4 nits. Fixed: hold rows dropped from the allow-list; open children ruled out; every server case fails only on its named rule. Decided and recorded on the card: safety over coverage; built and held tasks never offered.

#### Iteration 4
0 blockers, 3 warnings, 3 nits. Fixed: every task below at any depth checked; a try/catch around the offer (the list always answers); the filer's own wait counts; the plain-list test can fail. Recorded: the tmux-session identity limit.

#### Iteration 5
0 blockers, 2 warnings, 2 nits. Fixed: tasks below get the task's own checks and histories; a 5 s deadline on the server test's requests.

#### Iteration 6
0 blockers, 2 warnings, 4 nits. Fixed: a task with anything under it is never offered (a closed step's history always has a row naming nobody, so the descendant checks could never pass); the loop guard above the parent tested in a child process with a deadline.

#### Iteration 7
0 blockers, 1 warning, 2 nits. Fixed: the allow-list's named-agent rule for assigned, built, unbuilt and run rows tested both ways and against the real writers.

#### Iteration 8
0 blockers, 1 warning, 2 nits, all fixed: an open sibling under the parent that is the person's, built or held rules it out (two controls; older fixtures separated). Not reviewed again: the 8-round cap.
