---
pre_challenge: true
method: challenge-loop
branch: allowance-pct-3946
diff_hash: 780e59a3f09545361b53b693ed1bf518563c434ec873e868a368ea997d4498c6
validation: failed (deferred by the author: four final-gate runs each red on one unrelated timing test under machine load 50 to 70, each green alone; CI on a clean runner must be green before merge)
subdir_audit: passed
timestamp: 2026-09-26T23:48:37Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (6.0 initial validation passed, so iteration 1 is the first reviewer)
**Converged:** Yes, at iteration 8 (no new BLOCKER, WARNING or CONVENTION)
**Total findings:** 26 actionable (0 BLOCKERs, 21 WARNINGs, 5 CONVENTIONs), plus NITs
**Fixed:** 23 | **Deferred:** 3 | **Asked (awaiting user):** 0

### Final validation (6j), stated as it happened

The loop converged, then the final gate ran four times and was red each time on ONE test, a different
one or a repeat, never in a file this branch touches:
- `the watchdog uses the longer wait only for a win32 device sign-in` (engine/openaiaccounts.devicecode-3436.test.js)
- `#3626: a hung tunnel does not hold announce()` (engine/updating-988.test.js)
- `#1618: two callers asking for the shelf at once verify each door ONCE` (server.doorflight-1618.test.js), twice

Each file passes alone (15/15, 40/40, 4/4, repeated). The suite's own footer reported 1-minute load
47 to 74 on 10 cores during these runs. `STOP-FINAL-VALIDATION-RETRIES` fired at three; under the
fleet's standing rule the author decided rather than waited: deferred, recorded here as failed, and
CI on a clean runner must be green before the PR merges. Weakest premise: that all four reds are
contention. What would change it: CI red on any of the three.

Between the third and fourth runs the branch was found to conflict with main (both sides added an
export on one line); the merge kept both, and 523 tests across the touched suites plus the swarm
browser check (79 checks) passed on the merged tree before the fourth run.

### Per-Iteration Breakdown

The Self-generated line is recorded as not measured: the 6c-bis blame lookup was not run, and this
field must not be filled in by judgement.

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** not measured
- [WARNING] engine/allowance.js calibration comment claimed "never late"; whole-point rounding could make it late --> FIXED (divide by points + 1; claim deleted) dd6d7c72
- [WARNING] engine/allowance.js a 2-point morning overwrote a heavier stored day --> FIXED (replace only on as many points) dd6d7c72
- [WARNING] web/index.html slider mode could flip while held --> FIXED (mode set inside the focus guard; S34d) dd6d7c72
- [WARNING] web/index.html a token limit shown as a clamped % --> FIXED ("about N%", out of scale stays in tokens; S34b, S34c) dd6d7c72
- [WARNING] server.js account switch mid-day inflates a point --> FIXED (named in the plan, the one-direction claim removed) dd6d7c72

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** not measured
- [WARNING] engine/swarm.js rederiveLimits moved a paused swarm's limit off pausedAtLimit --> FIXED (paused swarms skipped; test) e4591576
- [WARNING] engine/status.js calibration read for non-swarm cards --> FIXED e4591576

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 2 CONVENTIONs, 4 NITs
**Self-generated:** not measured
- [WARNING] server.js no calibration until a swarm exists --> FIXED (every account measured; test) 29cba4af
- [WARNING] engine/allowance.js heavy day could hold until 7-day expiry --> FIXED (replaceable after 3 days; test) 29cba4af
- [WARNING] server.js a % on an uncalibrated account cleared today's override --> FIXED (only a changed token limit is new; test) 29cba4af
- [WARNING] server.js two spellings of one account folder split its tokens --> FIXED (realpath) 29cba4af
- [CONVENTION] server.js orphaned #3564 comment --> FIXED 29cba4af
- [CONVENTION] engine/status.js orphaned #3564 comment --> FIXED 29cba4af

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** not measured
- [WARNING] server.js metered a plain agent without the ownership filter --> FIXED (status.ownsFor) 6651dfad
- [WARNING] engine/status.js claudeAccountDirOf untested --> FIXED (test, mutation red) 6651dfad
- [CONVENTION] CLAUDE.md module map missing the calibration --> FIXED 6651dfad

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** not measured
- [WARNING] server.js outside use can make the error large, unstated --> FIXED (plan states it plainly; no invented floor) d6560a0d
- [WARNING] web/index.html a stopped % swarm fell back to tokens and a slider move dropped its % --> FIXED (offline card carries the calibration; test) d6560a0d
- [WARNING] server.js a PUT with % and tokens kept the sent tokens --> FIXED (tokens always from the %; test, mutation red) d6560a0d
- [CONVENTION] engine/status.js production read of HOME_FOR_TEST --> DEFERRED then (no exported accessor); FIXED in iteration 7

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** not measured
- [WARNING] web/index.html create could send a % as millions of tokens when the account list refilled without a repaint --> FIXED (repaint and refuse; S33b) 7a9470ef

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION (repeat), 3 NITs
**Self-generated:** not measured
- [WARNING] server.js an agent stopped mid-day lowered the day's count --> FIXED (the day's count only grows; test, mutation red) c6adb0a8
- [WARNING] server.js a partial meter read lowered the count --> FIXED (unread count changes nothing; test, mutation red) c6adb0a8
- [WARNING] engine/swarm.js tokens-only PUT on a % swarm restored by the sweep --> FIXED (clears the %; test, mutation red) c6adb0a8
- [WARNING] engine/allowance.js a step first seen after midnight counts as today's points --> FIXED (named in the plan; the figure has no timestamp to correct by) c6adb0a8
- [CONVENTION] engine/status.js HOME_FOR_TEST --> FIXED (accounts.homeDir exported and used) c6adb0a8

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** not measured
**Converged** -- no new actionable findings.

### Final Ledger (actionable only)

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/allowance.js | not measured | "never late" claim vs rounding | FIXED | dd6d7c72 |
| 2 | 1 | WARNING | engine/allowance.js | not measured | light morning overwrote heavy day | FIXED | dd6d7c72 |
| 3 | 1 | WARNING | web/index.html | not measured | slider mode flipped while held | FIXED | dd6d7c72 |
| 4 | 1 | WARNING | web/index.html | not measured | clamped derived % | FIXED | dd6d7c72 |
| 5 | 1 | WARNING | server.js | not measured | account switch direction unstated | FIXED | dd6d7c72 |
| 6 | 2 | WARNING | engine/swarm.js | not measured | paused limit re-derived | FIXED | e4591576 |
| 7 | 2 | WARNING | engine/status.js | not measured | calibration read for non-swarms | FIXED | e4591576 |
| 8 | 3 | WARNING | server.js | not measured | first swarm cannot be % | FIXED | 29cba4af |
| 9 | 3 | WARNING | engine/allowance.js | not measured | heavy day held to expiry | FIXED | 29cba4af |
| 10 | 3 | WARNING | server.js | not measured | % without tokens cleared override | FIXED | 29cba4af |
| 11 | 3 | WARNING | server.js | not measured | folder spellings split tokens | FIXED | 29cba4af |
| 12 | 3 | CONVENTION | server.js | not measured | orphaned comment | FIXED | 29cba4af |
| 13 | 3 | CONVENTION | engine/status.js | not measured | orphaned comment | FIXED | 29cba4af |
| 14 | 4 | WARNING | server.js | not measured | no ownership filter | FIXED | 6651dfad |
| 15 | 4 | WARNING | engine/status.js | not measured | claudeAccountDirOf untested | FIXED | 6651dfad |
| 16 | 4 | CONVENTION | CLAUDE.md | not measured | module map | FIXED | 6651dfad |
| 17 | 5 | WARNING | plan | not measured | outside-use magnitude unstated | FIXED | d6560a0d |
| 18 | 5 | WARNING | web/index.html | not measured | offline % swarm lost its % | FIXED | d6560a0d |
| 19 | 5 | WARNING | server.js | not measured | % with tokens kept tokens | FIXED | d6560a0d |
| 20 | 5 | CONVENTION | engine/status.js | not measured | HOME_FOR_TEST | FIXED | c6adb0a8 |
| 21 | 6 | WARNING | web/index.html | not measured | stale create mode | FIXED | 7a9470ef |
| 22 | 7 | WARNING | server.js | not measured | stopped agent lowers count | FIXED | c6adb0a8 |
| 23 | 7 | WARNING | server.js | not measured | partial read lowers count | FIXED | c6adb0a8 |
| 24 | 7 | WARNING | engine/swarm.js | not measured | tokens-only PUT reverted | FIXED | c6adb0a8 |
| 25 | 7 | WARNING | engine/allowance.js | not measured | after-midnight step | DEFERRED | named in the plan: early, and the figure carries no timestamp |
| 26 | 4-7 | NIT-level repeats | server.js | not measured | real meter path for plain agents is untested (seam used) | DEFERRED | the workdir transcript fixture is out of reach of this test file; ownership wiring is the same status.ownsFor the card uses |

### NITs (non-blocking)
- engine/allowance.js the calibration file rewrote every minute (fixed in iteration 7: no write when nothing moved)
- web/index.html d-swarm-cap-sub not reset when cap is falsy (unreachable: a swarm always has a limit)
- engine/swarm.js the pause sentence names tokens for a % swarm (true, and the page shows the %)
- web/index.html the create default 3 is a second copy of ALLOWANCE_PCT_DEFAULT (same pattern as maxHelpers)
- server.js readCalibration(claudeAccountDirOf(name)) appears three times (iteration 8)
- plan: two weakest-premise notes live in two places (iteration 8)

### Strengths (across iterations)
- Each error direction is named separately in the plan, with its size where it can be large
- Every new rule has a test that was shown to go red with the rule removed
- The page never sends a % as tokens or the reverse (S33b, S34d), with controls
- The server test builds its roster from real board cards, not hand-made rows
