---
pre_challenge: true
method: challenge-loop
branch: switchend-5460
diff_hash: 0833aac91f4b943a50ad7f3bed0bdfa623b0f784a4fd8b6d57e7ebe8d7e88b82
validation: passed (focused: all 55 community test files plus the file-scanning guards, 1000 tests, 998 pass, 0 fail, 2 skipped, on the rebased head; GitHub CI runs the full suites)
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-07T23:22:34Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (reviewers diffed against Renet's sendwhy-5435, the stacked base; rebased onto main after #5499 merged, 5 commits replayed clean)
**Converged:** Yes (iteration 4 raised only duplicates of accepted trade-offs, and NITs)
**Total findings:** 0 BLOCKERs, 9 WARNINGs, several NITs
**Fixed:** 7 WARNINGs | **Deferred:** 2 WARNINGs (accepted trade-offs, in the plan) | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/communitysend.js endOnPeriod — a flapping switch left a window open forever --> FIXED (bece64b1c)
- [WARNING] engine/communityswitch.js read — a file that stays corrupt stalled every read 150 ms --> FIXED (bece64b1c)
- [NIT] _setPause comment; newest-20 check; pause hook not restored --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/communityswitch.js — a slow changing writer stalled every read --> FIXED (3e855998f, 2 s gap)
- [WARNING] engine/communityswitch.js — a second lock on an unchanged file is not retried --> DEFERRED: the price of not stalling readers on a lasting failure (plan, Review 2)
- [WARNING] engine/communitysend.js endOnPeriodNow — the person's OFF did not close an open window --> FIXED (3e855998f)
- [NIT] at unread; assertion wording; read() doc --> FIXED

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the window logic from iteration 1's fix)
- [WARNING] engine/communitysend.js — a window reached into a period a route started (probe-confirmed) --> FIXED (4a0680b78)
- [WARNING] engine/communityswitch.js — the retry gap started on recovered rounds --> FIXED (4a0680b78), test shown red on the old behaviour
- [NIT] Atomics freezes the whole process (comment); stale plan line --> FIXED; test hooks on the module exports --> left (labelled tests-only)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 new WARNINGs (3 duplicates of accepted trade-offs: the stall bound, the gap, the open window until the next sweep), NITs only
**Self-generated:** 0
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/communitysend.js endOnPeriod | BRANCH | window left open by a flapping switch | FIXED | bece64b1c |
| 2 | 1 | WARNING | engine/communityswitch.js read | BRANCH | corrupt file stalls every read | FIXED | bece64b1c |
| 3 | 2 | WARNING | engine/communityswitch.js read | BRANCH | slow writer stalls every read | FIXED | 3e855998f |
| 4 | 2 | WARNING | engine/communityswitch.js read | BRANCH | second lock on unchanged file not retried | DEFERRED | accepted trade-off |
| 5 | 2 | WARNING | engine/communitysend.js endOnPeriodNow | BRANCH | OFF does not close an open window | FIXED | 3e855998f |
| 6 | 3 | WARNING | engine/communitysend.js sinceForOnPeriod | SELF | window reaches into a later period | FIXED | 4a0680b78 |
| 7 | 3 | WARNING | engine/communityswitch.js read | BRANCH | gap started by recovered rounds | FIXED | 4a0680b78 |

### NITs (non-blocking, across all iterations)
- Test hooks (_setPause, _endRetryGap) are on the module exports (iteration 3), labelled tests-only.
- Review-number tags in comments read as opaque outside the PR (iteration 4).

### Strengths (across all iterations)
- Nothing newly sends: only status words change, and unreadable still ends the period (#5435) (iterations 1, 2, 4)
- Every write to state.json keeps endedUnreadable and never drops a start (iterations 2, 3, 4)
- The tests drive the real sweep and status reader on real posts, each with a control (iterations 1 to 4)
- Rebased onto origin/main after #5563 (13:22 CDT 2026-10-08): clean. Main's engine.reachable now reads every exports block (#5548), so this branch's two communityswitch.js test seams (_setPause, _endRetryGap) are excused there with reasons (one commit, test file only). Built main + this branch with git merge-tree: engine.reachable then fails only on main's own known costOf line (#5600). diff_hash recomputed.
