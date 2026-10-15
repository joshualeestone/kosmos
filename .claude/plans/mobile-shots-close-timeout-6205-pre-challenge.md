---
pre_challenge: true
method: challenge-loop
branch: mobile-shots-close-timeout-6205
diff_hash: 5b4ac295b39ac705c7ff94beb19e78a194f5e8f668a2fe7394b12eb618753c35
validation: passed
subdir_audit: passed
timestamp: 2026-10-15T11:01:12Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 (blind, model-rotated: opus / sonnet / opus / sonnet / opus)
**Converged:** Yes (iteration 5 found zero new BLOCKER/WARNING/CONVENTION)
**Total findings:** 7 WARNINGs + 1 CONVENTION + several NITs; plus 1 synthetic finding at the final-validation gate (6j)
**Fixed:** 8 (7 WARNINGs + the 6j indexed finding) | **Deferred:** 1 CONVENTION + NITs

The change bounds every browser/context close (and newContext) in docs/browser-checks/mobile-shots.js against a timer, via the new docs/browser-checks/lib-bounded-close.js, so a dead engine fails the run in seconds instead of hanging it (one wedge held the shared run queue for 3h06m). On a wedged close it SIGKILLs the engine's whole process tree by pid (never a pattern), signalling only captured pids still our children at kill time (pid-reuse guard).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKER, 0 WARNING, 1 CONVENTION, 2 NITs
**Self-generated:** 0 (nothing committed by this loop yet)
- [CONVENTION] .claude/plans/ -- no plan file for this branch --> DEFERRED: focused direct bugfix; design captured in the commit messages and card #6205.
- [NIT] lib-bounded-close.js -- captures direct children only (helpers are grandchildren); [NIT] test filename form. Recorded; addressed in iter 2-4.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKER, 3 WARNINGs, 0 CONVENTION, NITs
**Self-generated:** 0 (branch code under review)
- [WARNING] withTimeout's watchdog timer was unref'd (could let node exit 0 with no verdict on a hung close) --> FIXED (ref it; cleared on settle).
- [WARNING] a timed-out ctx.close() was swallowed and the loop opened another unbounded context on the wedged browser --> FIXED (closeContextBounded returns false; the engine loop breaks; newContext bounded).
- [WARNING] the force-kill reaped only node's direct child (webkit/firefox launch through a wrapper, so the real engine is a grandchild) --> FIXED (reap the whole process tree under each still-ours captured pid).

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKER, 1 WARNING, 0 CONVENTION, NITs
**Self-generated:** 1 (the close-wedge line this loop added in iter 2)
- [WARNING] the per-screen close-wedge path set the engine's wedged flag but did not errors++, so a run that dropped screens could exit 0 (a false green) --> FIXED (errors++ + FLAG, matching the newContext-wedge path).
- [NIT] two ps reads duplicated --> FIXED (childPidsOf derives from psParentMap: one read, one parse).

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKER, 3 WARNINGs, 0 CONVENTION, NITs
**Self-generated:** 2 (the capture + newContext lines this loop added)
- [WARNING] the engine-pid capture could pick up the transient ps process childPidsOf itself spawns --> FIXED (intersect two post-launch reads; the engine persists in both, each read's ps child differs).
- [WARNING] the bounded newContext relabelled a genuine rejection as a timeout/wedge --> FIXED (branch on e.timedOut; a real rejection propagates out as before).
- [WARNING] the review-added control flow had no behavioural test and the wiring regex did not pin bounded newContext --> FIXED (wiring asserts newContext is bounded and both wedge paths errors++).
- [NIT] the synchronous ps read was unbounded --> FIXED (5s execFileSync timeout).

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKER, 0 WARNING, 1 CONVENTION (the deferred plan-file), 2 NITs
**Self-generated:** 0
**Converged** -- the only non-NIT finding is the already-deferred plan-file CONVENTION.
- [NIT] a wedged FINAL browser.close() (after all screens succeeded) is force-killed but not counted an error --> DEFERRED: the deliverable is complete, so a teardown-only wedge is intentionally not a FAIL.
- [NIT] a no-engine-pid-captured case could orphan the engine --> DEFERRED: the close is still bounded (no hang), reviewer confirms not a regression.

### Final-validation gate (6j)
The first 6j full-suite run flagged two failures. One, browser-checks-indexed (the new helper lib-bounded-close.js was not named in the README), was mine --> FIXED (README row added, commit 96a248342). The other, tools.mobile-shots-serviceworker-6206 (control: screens 99 vs declared 95), was measured identical on origin/main and so PRE-EXISTING, not this change; the other fleet had already landed "#6206 guard: count SCREENS by structure" on current main (Liu Kang m5697). After rebasing onto current main, the final 6j recorded a clean PASS (stack=typescript, hash 5b4ac295b39a) with no failing tests.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | CONVENTION | .claude/plans/ | BRANCH | No plan file for branch | DEFERRED | Focused bugfix; design in commits + #6205 |
| 2 | 2 | WARNING | lib-bounded-close.js | BRANCH | unref'd watchdog could exit 0 with no verdict | FIXED | ref the timer |
| 3 | 2 | WARNING | mobile-shots.js | BRANCH | newContext unbounded on a wedged browser after a close timeout | FIXED | return-false + break + bound newContext |
| 4 | 2 | WARNING | lib-bounded-close.js | BRANCH | force-kill reaped only the direct child | FIXED | reap the process tree |
| 5 | 3 | WARNING | mobile-shots.js | SELF | close-wedge path did not errors++ (false green) | FIXED | errors++ + FLAG |
| 6 | 4 | WARNING | mobile-shots.js | SELF | engine-pid capture caught the transient ps pid | FIXED | two-sample intersection |
| 7 | 4 | WARNING | mobile-shots.js | SELF | newContext rejection relabelled as a wedge | FIXED | branch on e.timedOut |
| 8 | 4 | WARNING | test | SELF | review-added paths unpinned | FIXED | wiring asserts bounded newContext + both wedge paths errors++ |
| 9 | 6j | BLOCKER-at-gate | README.md | BRANCH | new helper not indexed in the README | FIXED | 96a248342 |

### NITs (non-blocking, across all iterations)
- lib-bounded-close.js: two ps reads at kill time (single snapshot would be airtight) -- small TOCTOU, fail-safe (iter 3/4).
- test: the never-resolving control is close to tautological; the real-resolver tests poll up to 1s (fine on mac/linux) (iter 2/4).
- mobile-shots.js: a FINAL-teardown-only wedge is intentionally not a FAIL; a no-pid-captured case could orphan the engine (both fail-safe, iter 5).

### Strengths (across all iterations)
- The timeout, not the kill, is the load-bearing fix; the force-kill is secondary cleanup, so even a degraded pid capture cannot reproduce the hang.
- The pid-reuse guard is genuinely tested (a departed/reused pid is never signalled) and the whole engine tree is reaped.
- withTimeout handles the late-rejection race (Promise.race attaches a handler to every input), avoiding the #6022 unhandled-rejection class.
- Kills are strictly by pid, never a pattern; ps -A -o pid=,ppid= is portable macOS/Linux with the -e pitfall documented.
- The wiring test forbids any bare await ctx.close()/browser.close()/browser.newContext() from surviving in mobile-shots.js.
