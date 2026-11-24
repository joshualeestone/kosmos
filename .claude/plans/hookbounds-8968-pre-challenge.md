---
pre_challenge: true
method: challenge-loop
branch: hookbounds-8968
diff_hash: eeeae94542680228a877701d8bc0dbc26d66f5d14e9047e06b86f207535955aa
validation: passed
subdir_audit: passed
timestamp: 2026-11-24T08:38:47Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 12 (1 BLOCKER, 7 WARNINGs, 0 CONVENTIONs, 4+ NITs)
**Fixed:** 5 | **Deferred:** 3 | **Asked (awaiting user):** 0

Initial validation (6.0): the two changed files were run directly (11 of 11) with four mutants; the full suite ran once
at the end through the heavy queue (validation_rc=0, audit_rc=0, QUEUED-HEAVY END rc=0 at 02:33 CST), since a queued
full run cannot share the tree with edits.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [BLOCKER] engine/kosmos-report-hook.exit-8014.test.js:107 - the tail bound cannot see a hook that waits on the stalled keep-copy body before its last request (measured: res.text() in place of res.body.cancel() ran 3057 ms and passed) --> FIXED (7f1159942a): the keep-copy arm also bounds the gap from /api/undo/keep to the next request or close; mutant reds at 2985 ms
- [WARNING] .claude/plans/hookbounds-8968.md:10 - plan did not say the keep-copy arm lost that coverage --> FIXED (7f1159942a)
- [NIT] exit-8014 header "no bound here is a total wall-clock time" literally false (a lower bound remains) --> fixed, "no upper bound"
- [NIT] killguard CPU comment reasoned not measured --> comment notes GC threads

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] exit-8014.test.js:103 - stdin arm's 8000 ms ceiling left only 3 s for a stall inside the child --> FIXED (1d5e528764): 9000 ms, still reds a 10 s backstop
- [NIT] keep gap is the tighter mutant, plan silent --> plan names it
- [NIT] cpuUsage load claim asserted --> plan marks it reasoned

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above (the 9000 ceiling, written in iteration 2)
- [WARNING] exit-8014.test.js:103 - the 9000 ms wall-clock ceiling passes a 6, 7 or 8 s backstop, which would break the hook entry's 15 s ceiling --> FIXED (9e680ed361): a preload wraps setTimeout and records each timer's armed delay; the timer that ran the hook must be armed 4500 to 5000 ms; 7 s and 10 s mutants red by name
- [WARNING] exit-8014.test.js:9 and plan - "a slow start is not counted" was only partly true (module load sat inside the window) --> FIXED (9e680ed361): the bound no longer reads wall time at all
- [NIT] CPU time cannot see a wait that spends no CPU --> comment says so
- [NIT] plan hard wraps --> rewritten

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs (all DEFERRED, below), 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] exit-8014.test.js:117 - another timer could fire between the backstop and the first request --> DEFERRED: no timer of the hook can: the only timers armed before the first request are request aborts of 3 s and more, armed with that request; a future change that adds one reds loudly naming the timer, it cannot pass vacuously (plan, weakest premise)
- [WARNING] exit-8014.test.js:127 - 50 ms headroom on the red side of the tail bound --> DEFERRED: by design and stated in the plan; the regression is at least 2000 ms by construction, and the green side has about 1.9 s
- [WARNING] killguard-8406.test.js:305 - CPU time inflates under contention and cannot see a CPU-free wait --> DEFERRED: both stated in the comment and plan; the guarded class (a runaway pattern) spends CPU
- [NIT] stderr now carries the preload's marks; nothing asserts it empty
- [NIT] keep gap and tail measure the same interval when keep is last
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | engine/kosmos-report-hook.exit-8014.test.js:107 | BRANCH | tail blind to a wait on the stalled body | FIXED | 7f1159942a |
| 2 | 1 | WARNING | .claude/plans/hookbounds-8968.md:10 | BRANCH | plan silent on lost coverage | FIXED | 7f1159942a |
| 3 | 2 | WARNING | engine/kosmos-report-hook.exit-8014.test.js:103 | BRANCH | 8000 ms ceiling too tight | FIXED | 1d5e528764 |
| 4 | 3 | WARNING | engine/kosmos-report-hook.exit-8014.test.js:103 | SELF | 9000 ms ceiling passes a 6 to 8 s backstop | FIXED | 9e680ed361 |
| 5 | 3 | WARNING | engine/kosmos-report-hook.exit-8014.test.js:9 | BRANCH | slow start claim partly false | FIXED | 9e680ed361 |
| 6 | 4 | WARNING | engine/kosmos-report-hook.exit-8014.test.js:117 | BRANCH | timer ordering premise | DEFERRED | no earlier timer can fire; reds loudly |
| 7 | 4 | WARNING | engine/kosmos-report-hook.exit-8014.test.js:127 | BRANCH | 50 ms red-side headroom | DEFERRED | by construction, documented |
| 8 | 4 | WARNING | engine/kosmos-report-hook.win32-killguard-8406.test.js:305 | BRANCH | CPU time scope | DEFERRED | documented, matches guarded class |

### NITs (non-blocking, across all iterations)
- exit-8014 header wording (iteration 1, fixed)
- killguard CPU comment (iteration 1, fixed)
- keep gap is the tighter mutant (iteration 2, plan)
- cpuUsage load claim reasoned (iteration 2, plan)
- CPU time cannot see a CPU-free wait (iteration 3, comment)
- plan hard wraps (iteration 3, fixed)
- stderr carries preload marks (iteration 4)
- keep gap and tail overlap when keep is last (iteration 4)

### Strengths (across all iterations)
- The tail bound rests on an invariant (the 2 s exit timer is armed only after the last answer), so load can only lengthen a regressed tail (iterations 1, 2, 3)
- The preload timer record makes the stdin arm independent of load entirely (iteration 4)
- cpuUsage follows engine/backupscan.test.js precedent (iterations 1 to 4)
- Every bound has a mutant that reds it and a sleep control that shows wall time no longer counts (iterations 1 to 4)
