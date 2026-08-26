---
pre_challenge: true
method: challenge-loop
branch: abandoned-signin-727
diff_hash: bb25f4804f92a82cf910172e84c76b104bf7d48401339536e27d051a566ee8ed
subdir_audit: passed
timestamp: 2026-08-26T10:04:59Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7
**Converged:** Yes (iteration 7: zero BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 24 across 7 iterations (0 BLOCKERs, 13 WARNINGs, 11 NITs; STRENGTHs each round)
**Fixed:** 15 | **Deferred with reasoning:** 6

This closes kosmos#727 item 4 (an abandoned browser leg during Claude sign-in never
expires) and the related #897 report (a sign-in that actually succeeded showed no
confirmation, because the pre-existing "config outranks the screen" check was only
wired into some of the driver's screens, not the two it needed most). Seven rounds is
longer than most branches; no round found a BLOCKER, but round 2 found a genuine
functional bug (a transient blank terminal capture silently resetting the whole
15-minute abandonment timer to zero), and rounds 1 and 3-6 progressively closed test
coverage gaps and hardened timing margins that could otherwise flake under real
machine jitter -- a real, if less dramatic, category of defect for a driver whose
whole job is racing wall-clock time against a person's real behavior. Round 7 found
nothing new.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 4 WARNINGs, 3 NITs, 3 STRENGTHs
- [WARNING] missing regression test for the `browser-open` half of the new
  config-outranks-screen `||` condition (only `awaiting-code` was tested). --> FIXED
  (new dedicated test).
- [WARNING] missing test for config-outranks-screen firing while `mem.phase` is mid
  the pre-existing reject-cycle grace window. --> FIXED (new dedicated test).
- [WARNING] a narrow, inherent tick-boundary race between the new expiry and a
  sign-in that completes in the same instant. --> DEFERRED, documented explicitly in
  code as an accepted residual (matches every other timing decision in this file's
  own granularity).
- [WARNING] README.md's existing claim that an abandoned sign-in "does not leave on
  its own" was now false. --> FIXED.
- [NIT] `finishConnected()` called without `await` at the new call site, perpetuating
  a pre-existing inconsistency. --> FIXED (added `await`).
- [NIT] `ABANDONED_SIGNIN_MS`'s 15-minute default duplicated `FRESH_BOUND_MS`'s
  literal by coincidence, not by code. --> FIXED (shared `DEAD_BOUND_MS` constant).
- [NIT] steady-state `subscription.check()` cost on every tick. --> DEFERRED: mirrors
  this file's own pre-existing pattern for other screens, not a new cost class.

#### Iteration 2
**New findings:** 3 WARNINGs, 1 NIT, 4 STRENGTHs
- [WARNING] missing browser-open coverage for the expiry/reset/not-disturbed tests
  specifically (only the config-check had it). --> FIXED (new dedicated test).
- [WARNING] **Real bug**: a transient `blank` pane capture silently reset the whole
  15-minute abandonment clock to zero, because the reset `else` branch did not
  exclude `blank` the way `unknown` is excluded (via an earlier `return`). Caught by
  direct code tracing. --> FIXED, with a dedicated regression test verified (by
  temporarily reverting the fix) to actually fail without it.
- [WARNING] 15 minutes may be tight for a genuinely slow one-time-code delivery.
  --> DEFERRED as a product/UX judgment call, documented in the plan file for Josh's
  awareness; trivially tunable via one constant if wrong.
- [NIT] the expiry sentence was identical for both browser-open and awaiting-code.
  --> FIXED (kind-aware message).

#### Iteration 3
**New findings:** 1 WARNING, 2 NITs, 4 STRENGTHs
- [WARNING] `subscription.check()` cost, restated. --> DEFERRED (same reasoning as
  iteration 1).
- [NIT] `setAbandonedSigninMs(0)` falls back to the default instead of forcing
  immediate expiry (0 is falsy) -- mirrors a pre-existing sibling function's
  identical behavior. --> DEFERRED: not a new defect, no live occurrence, left
  consistent with its sibling.
- [NIT] no dedicated test proving a `cancel()` mid-countdown leaves no late STUCK.
  --> FIXED (new dedicated test, reasoning traced and made explicit).

#### Iteration 4
**New findings:** 2 WARNINGs, 1 NIT, 2 STRENGTHs
- [WARNING] `subscription.check()` production I/O volume, restated with more
  precision. --> DEFERRED (same reasoning; noted for the PR description).
- [WARNING] `browserWaitSince` is ONE shared clock across both browser-open and
  awaiting-code (a combined 15-minute budget, not 15 minutes per stage). --> Judged a
  deliberate, defensible design choice (documented explicitly in code and in the plan
  file's new "Deferred design tradeoffs" section) rather than a bug; the alternative
  (two independent clocks) would allow up to 30 minutes total.
- [NIT] missing test for the actual `browser-open` -> `awaiting-code` transition
  (the real-world path #727/#897 lived in) proving the clock survives it unrestarted.
  --> FIXED (new dedicated test, verified by injecting a restart-on-transition bug
  and confirming the test fails, then restoring the fix).

#### Iteration 5
**New findings:** 2 WARNINGs, 2 NITs, 3 STRENGTHs
- [WARNING] `setAbandonedSigninMs` was reset only in `driverTest`'s teardown, not its
  setup, unlike its two sibling pacing knobs. --> FIXED.
- [WARNING] the new browser-open->awaiting-code transition test's timing margin
  (~150ms) was tight enough to flake under real jitter. --> FIXED (scaled the whole
  test up 5x -- 400ms->2000ms budget, 250ms->1200ms pre-transition sleep,
  250ms->1400ms poll window -- preserving the same discriminating ratio with real
  absolute headroom).
- [NIT] README wording ("never reaches... again") read ambiguously. --> FIXED.
- [NIT] the expiry message always said "no code was entered" even when a code WAS
  typed and rejected before the person gave up. --> FIXED (message now distinguishes
  via the existing `owner.codeTyped` flag), with a new dedicated test.

#### Iteration 6
**New findings:** 1 WARNING, 2 NITs, 3 STRENGTHs
- [WARNING] the "submitting a code re-arms the expiry" test had the same class of
  tight (~150ms), single-fixed-checkpoint timing margin the transition test was
  scaled up for in iteration 5, but was missed. --> FIXED (scaled up 5x with the same
  worked-through ~750ms headroom on both sides).
- [NIT] minor message wording ("no other" -> "no other code"). --> FIXED.
- [NIT] `subscription.check()` cost, restated a third time. --> DEFERRED (same
  reasoning, now well-established across three independent reviews).

#### Iteration 7
**New findings:** 0 BLOCKER, 0 WARNING, 0 CONVENTION, 2 NITs, 3 STRENGTHs

**CONVERGED.** The reviewer actually re-ran the full test suite fresh (49/49 driver
tests, 2182/2182 full suite) rather than trusting prior rounds, traced the new code's
interaction with every existing tick-scoped counter in the file, and explicitly
considered (per this iteration's brief) whether an injectable clock seam would be a
more fundamental fix than continued margin-scaling -- concluding it is a legitimate
but not necessary design question for this PR, since it would deviate from every
other timing bound in this file being tested the same real-clock way, and the
margins are now verified holding. Both remaining NITs are explicitly framed as
"not blocking" wording polish, left as-is per the reviewer's own recommendation.

### Final Ledger (condensed -- full detail in the per-iteration breakdown above)

| # | Iter | Category | Area | Status |
|---|------|----------|------|--------|
| 1-4 | 1 | WARNING | missing tests (2), residual race, stale README | FIXED (3) / deferred (1) |
| 5-6 | 1 | NIT | await, literal duplication | FIXED |
| 7-9 | 2 | WARNING | missing browser-open test, **blank-tick clock reset bug**, 15-min tightness | FIXED (2) / deferred (1) |
| 10 | 2 | NIT | kind-aware message | FIXED |
| 11 | 3 | WARNING | `subscription.check()` cost | DEFERRED |
| 12-13 | 3 | NIT | `setAbandonedSigninMs(0)`, missing cancel test | DEFERRED (1) / FIXED (1) |
| 14-15 | 4 | WARNING | I/O volume restated, shared-clock design | DEFERRED (documented) |
| 16 | 4 | NIT | missing transition test | FIXED |
| 17-18 | 5 | WARNING | setup/teardown asymmetry, tight transition-test margin | FIXED |
| 19-20 | 5 | NIT | README wording, message honesty (codeTyped) | FIXED |
| 21 | 6 | WARNING | tight re-arm-test margin | FIXED |
| 22 | 6 | NIT | message wording | FIXED |
| -- | 7 | (none) | -- | CONVERGED |

### Deferred, with reasoning (none blocking)

- `subscription.check()`'s per-tick cost during `browser-open`/`awaiting-code` (raised
  independently in iterations 1, 3, 4, and 6): mirrors this file's own pre-existing
  pattern for other screens (`login-done`/`press-enter`/`repl` already call it every
  tick), not a new cost class, and needed to close #897. Worth a one-line PR-body note
  for a future perf pass, not a code change.
- The 15-minute abandonment bound, and specifically that it is ONE combined budget
  across both browser-open and awaiting-code rather than 15 minutes at each stage
  separately: both are deliberate, documented product judgment calls (see the plan
  file's "Deferred design tradeoffs" section), each fixable with a one-line change to
  `ABANDONED_SIGNIN_MS` if wrong in practice.
- `setAbandonedSigninMs(0)` falling back to the 15-minute default instead of forcing
  immediate expiry (0 is falsy): mirrors the pre-existing `setFreshnessForTests`
  sibling's identical behavior; no live occurrence; left consistent rather than
  fixed in isolation.
- The narrow tick-boundary race between the config-outranks-screen check and the
  abandonment expiry (iteration 1): documented explicitly in code as an accepted
  residual, at the same granularity every other timing decision in this file already
  accepts.

### Strengths (recurring across iterations, not restated per-round above)

- The THREE-ANSWERS-NOT-TWO discipline this file's own header mandates is applied
  correctly throughout: the config-outranks-screen check always runs before the
  expiry check on the same tick, so a sign-in that actually landed is never raced
  against its own expiry clock within a single tick.
- Every non-trivial claim in this diff has a dedicated regression test that was
  verified (by deliberately breaking the fix and confirming red, then restoring it)
  to actually fail without the corresponding code, not just tests that happen to pass.
- Both halves of every `||` condition this diff touches (`browser-open` vs.
  `awaiting-code`, for both the config-check and the expiry) are independently pinned
  by tests -- closing exactly the class of gap that caused #897 in the first place
  (a check wired into some screens but not others).
- The identity-based ownership guards (`driver !== owner`) that protect this file's
  existing `becomeStuck`/`finishConnected`/`tick` machinery from cancel/replace races
  were reused unchanged for the new code and independently verified (by a fresh
  reviewer tracing the guard by hand, and by a dedicated test) to hold for the new
  abandonment path specifically.
- `owner.browserWaitSince` and `owner.codeTyped` are correctly flow-scoped (live only
  on the in-memory per-flow `owner` object, never persisted, never reset explicitly
  but naturally fresh on every `start()`), verified across multiple independent
  reviews to be immune to cross-flow leakage or corruption.

### Full suite

`bash tools/run-tests.sh`: 0 failures throughout every iteration's final check.
Final run: 2182/2182 node tests, 255 bash-level PASS assertions, 0 failures.
`node --test engine/connect.test.js`: 49/49, including all 11 new/extended tests for
this feature. `node --test engine.reachable.test.js`: 1/1 (the new `setAbandonedSigninMs`
test seam is correctly excused).
