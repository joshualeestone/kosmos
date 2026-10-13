---
method: challenge-loop
branch: eventually-5727-remote
diff_hash: 7d4775896564bf3a4f3260051a288e3de2ded51f87393e8ecd71fcc653212299
validation: passed
subdir_audit: passed
iterations: 2
converged: true
---

# Pre-challenge proof: eventually-5727-remote (#5727 follow-up 1, engine/remote.test.js)

Migrates the three hand-rolled (c) poll-until-deadline helpers in `engine/remote.test.js` onto
the shared `eventually()` helper, keeping each signature and all call sites byte-identical:
`until(check, what, ms)` (COUNT-based, ~80 `await until(` sites plus the `failed`/`waiting`
arrow-wrappers), `setupSent()` (1 site) and `registerSent()` (8 sites). Plus one
`const { eventually } = require('../test-support/eventually');`.

## Validation

`unset KOSMOS_AGENT_TOKEN && node --test engine/remote.test.js` on Mortals (node v26.8.1):
- main baseline (before any edit): 216 tests, 216 pass, 0 fail, 0 cancelled, 0 skipped, EXIT=0.
- branch, scale 1 (`KOSMOS_TEST_TIME_SCALE` unset): 216 / 216 / 0, EXIT=0 -- identical to baseline.
- branch, forced `KOSMOS_TEST_TIME_SCALE=4`: 216 / 216 / 0, EXIT=0.
The blind reviewer re-ran scale 1 independently: 216 / 216 / 0, EXIT=0. One file changed, no
runner/helper code; CI re-runs the whole suite on the PR head as the authoritative green-by-name
gate.

counts-before-and-after: before, 3 hand-rolled poll bodies (`until` count loop; `setupSent` /
`registerSent` `while (Date.now() < deadline)`), 0 `eventually` require. After, 1 `eventually`
require, 3 `eventually()` calls (one per helper body), 0 Date.now-deadline loops in the three
helpers; the three signatures and every call site unchanged.

SUBDIR AUDIT: passed (no CLAUDE.md under engine/ or .claude/plans/; no directory added).

The diff_hash above is `git diff origin/main...HEAD` excluding this proof file, `shasum -a 256`,
the way the pre-challenge-gate hook recomputes it (base resolves to refs/remotes/origin/main).

## Polarity audit (per Liu m4894) -- every call site POSITIVE
All ~80 `await until(...)` sites wait for a state to be REACHED (`remote.status().state === 'up'`
/ `'restarting'`, a `recorded()` entry to appear, `remote.read().vouched[id]` to be noted, a
count to grow), then the test proceeds; a timeout fails the test. The two arrow-wrappers
(`failed` at ~920 used at 926/933, `waiting` at ~973 used at 980/994) and the `setupSent` (1) /
`registerSent` (8) sites are likewise positive. None is wrapped in `assert.rejects`, a
catch-as-success, or any expect-the-timeout form. The negative test "the register is never sent"
(~3094) does NOT use these helpers; it asserts on `recorded()` directly. The only `.catch` in the
file is on `remote.signinStart(...)`, unrelated. Independently re-enumerated by the blind pass.

## Equivalence: two cases (this batch's nuance, surfaced by the challenge pass)
- **`setupSent` / `registerSent` (already WALL-CLOCK `while (Date.now() < deadline)`):**
  byte-identical at scale 1, plus `eventually`'s one extra probe past the deadline -- for a
  positive wait that can only let a success land that the old loop would have failed, strictly
  more lenient, never stricter.
- **`until` (COUNT-based `ms/25` iterations) -> WALL-CLOCK:** NOT byte-identical; a deliberate
  refinement, the first count-based helper in the sweep. The old count loop's real duration
  stretched with per-iteration lag (accidentally load-adaptive, but UNBOUNDED -- a 15000ms wait
  could run minutes on a slow box). `eventually` gives an explicit deadline scaled by
  KOSMOS_TEST_TIME_SCALE (runner-computed, capped 4x): under the runner the scaled budget tracks
  the load the count loop adapted to by accident, now BOUNDED; at scale 1 unloaded the real
  durations match. The one case it is STRICTER than the old count loop is a bare `node --test`
  (scale 1) on a LOADED box -- the scenario this sweep targets, and the suite runs via the runner.
Both probe at t=0 with a 25ms step, so no cadence shift. The `until` timeout now throws a plain
`Error` (eventually's prefix) instead of an `AssertionError`; the 'timed out waiting for <what>'
text is preserved via `describe`, and nothing in the file asserts on it.

## Challenge-loop ledger (2 iterations)

### Iteration 1 (Sonnet, blind)
No [BLOCKER], no [CONVENTION]. The reviewer read `test-support/eventually.js` and the changed
file in full, enumerated every call site and confirmed all positive (the "register never sent"
negative test uses `recorded()` directly, not these helpers), confirmed throw propagation
(`eventually` awaits the probe with no catch), no assertion on the old timeout text, `(v) => v`
truthiness-equivalent to the old `if (check())`, the busy-waits inside the fake-CLI subprocess
strings and the (a)-family `assert.ok(Date.now()-t0 < N)` asserts untouched, and ran the file
(216/216, EXIT 0).
- **[WARNING] (acted on):** the `until` comment claimed "byte-identical at scale 1, strictly more
  lenient, never stricter". That is true for the two wall-clock helpers but NOT for `until`, which
  was COUNT-based: the old count loop's real duration stretched with lag (so it could run past
  `ms`), while `eventually` is wall-clock, so on a descheduled box at scale 1 the new path gets
  FEWER probes and is stricter. Reviewer judged it not a blocker ("only matters under heavy load,
  which this migration targets") and asked to correct the claim.

### Iteration 2 (author, addressing the WARNING)
Corrected the `until` code comment and the plan file to describe the count->wall-clock change
honestly: a deliberate refinement, sound under the runner that sets the scale, bounding a
previously-unbounded hang, and stricter only under a bare `node --test` at scale 1 on a loaded
box. This is a COMMENT/plan-text-only change (no executable line touched), so it cannot regress
behaviour and the blind pass's behavioural findings still hold; the 216/216 runs are unaffected.

### [NIT] (no change)
The `until` timeout message is noisier (`eventually: condition not met within Nms
(KOSMOS_TEST_TIME_SCALE 1x); timed out waiting for X`) and is a plain `Error` not an
`AssertionError`. Nothing matches on the text or the class, so it is harmless.

## Convergence
Two iterations: a blind behavioural pass (no BLOCKER/CONVENTION, one WARNING on an overclaiming
comment) and a comment/plan-text correction that resolves the WARNING without touching behaviour.
No BLOCKER / WARNING / CONVENTION outstanding. Converged.

## Origin classification
Every change is BRANCH-origin: the three helper bodies, the one `eventually` require, and the two
plan files. No other file is touched.
