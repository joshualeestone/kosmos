---
pre_challenge: true
method: challenge-loop
branch: missedrun-4787
diff_hash: a73e98c5705072172fa956bd70cf134a32623befda0597845c628af40c328a0d
validation: focused after every round (engine/taskrepeat.test.js, engine/tasks.repeat-4787.test.js, web.task-repeat-4787.test.js, web.tasks-view-3559.test.js), and at convergence every web.* page test plus engine/agentnudge, engine/assigner*, engine/tasks*, engine/taskrepeat and server.task-repeat-4787 (2710/2710, rc 0). Every new test was proven to fail by breaking the code it guards. Browser arm: render-tasks-view-3559, queued in the light lane (box held); CI runs it.
subdir_audit: not run
timestamp: 2026-10-06T19:51:54Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7
**Converged:** Yes (iteration 7: NO NEW ISSUES; a separate checker compared missed count, latest slot and late mark minute by minute over 540,000 cases on five rules and 145,500 across the Nov 1 clock change, 0 mismatches)

#### Iteration 1: 1 blocker, 2 warnings, 3 nits
- [BLOCKER] past the 99 cap the "latest" missed slot was the 99th from the start --> FIXED (latestAtOrBefore)
- [WARNING] late was measured against the oldest unanswered slot, so an on-time run after a missed day was late --> FIXED
- [WARNING] a run more than the early grace before its slot was called missed --> FIXED (a run up to the miss grace early answers its slot)
- [NIT] a rule change kept the late mark --> FIXED (cleared on a change)
- [NIT] no browser arm for the task page's red line --> DECIDED (covered by the shared tskRepeatMissed tests and the row arm; in the plan)
- [NIT] the red line names no next step --> DECIDED (the owner is nudged; in the plan)

#### Iteration 2: 1 warning, 2 nits
- [WARNING] a job reporting a few minutes early was late every run --> FIXED (late from the rule and the run's time only)
- [NIT] a run made under the old rule covered the new rule's first slot --> FIXED (dueSlot ignores a run before the rule was set)
- [NIT] a second runner in the same minute cleared the late mark --> FIXED (same answer for both)

#### Iteration 3: 1 warning, 1 nit
- [WARNING] a run well before its slot (08:44 for 9am) was late --> FIXED then REPLACED in round 4 (the nearer-slot rule)
- [NIT] runIsLate and dueSlot disagreed on a rule set exactly at a slot --> FIXED (strictly after, as dueSlot)

#### Iteration 4: 1 blocker, 1 nit
- [BLOCKER] the nearer-slot late rule contradicted the missed line (a Sunday run for a Monday job: not late, yet Monday missed) --> FIXED (answeredSlot, one rule for both; a property test over every run time for three rules)
- [NIT] the "waitingForNextRun is unchanged" test did not cover the one change --> FIXED (renamed, the case added with a control)

#### Iteration 5: 2 warnings
- [WARNING] a weekly miss read the same as its next run ("Monday at 9am") --> FIXED ("last Monday at 9am")
- [WARNING] the red line never appeared or cleared while the Tasks view stayed open --> FIXED (repeatMissAfter + tskRepeatStale reread, 5 minutes while red, at most one per 30 s)

#### Iteration 6: 1 blocker, 1 warning, 1 nit
- [BLOCKER] read inside a slot's grace, repeatMissAfter pointed at tomorrow, so the red line never came that day --> FIXED (first slot whose grace has not passed)
- [WARNING] a read slower than one poll was restarted every tick --> FIXED (readAt stamped when the read starts)
- [NIT] "last Monday" could read as the week before --> DECLINED (plain English for the most recent Monday)

#### Iteration 7: NO NEW ISSUES
