# Plan: eventually-5727 (PR-1 of the #5727 class fix)

## Problem
A full local suite on a contended box reds about one wall-clock test per run (#5727,
Mona's measurement). The class is ~88 hand-rolled `until`/`waitFor`/`poll` copies across
47 files, each polling a logical condition against a FIXED wall-clock deadline that
false-reds under host load. Measured on Mortals (12 cores): flakiness tracks load-per-core
(oversubscription), not absolute load, which is why Agent1s reds at a load Mortals shrugs off.

## Scope (Liu's call, m4867)
PR-1 = the shared `eventually()` helper + `KOSMOS_TEST_TIME_SCALE` set once by the runner
+ migrate ONLY the poll copies in files that actually went red. The other copies follow in
per-directory batches. #5723 and the (a) "assert-on-work-done" rewrites stay Mona's.

## Changes
- `test-support/eventually.js` (new): `eventually(probe, pred, {timeoutMs, stepMs, describe})`
  polls like the hand-rolled loops but multiplies the deadline by `KOSMOS_TEST_TIME_SCALE`.
  `SCALE` read once at module load, floored at 1 (never shortens a budget). Exports
  `eventually`, `scaleBudget`, `SCALE`.
- `tools/lib/test-time-scale.sh` (new): `kosmos_test_time_scale [load] [cores]` computes the
  scale = `load / (0.5 * cores)`, floor 1, cap 4x, knee at half-subscription. Fail-safe to 1
  on an empty/garbage load. Sourceable, bash 3.2 safe, with explicit-arg seams for the test.
- `tools/run-tests.sh`: source the lib and compute+export `KOSMOS_TEST_TIME_SCALE` ONCE before
  `seen_before`; it is always computed, never taken pre-set, so a forced value cannot bypass the
  floor/cap or print garbage in the banner (the knob for reproducing a load-driven flake locally
  is `KOSMOS_FAKE_LOAD`, which feeds the same clamped math). Add the scale to the suite banner so
  a reader of a red sees "wall-clock test time-scale Nx".
- `engine/openaiaccounts.chatgpt-reauth-2584.test.js`,
  `engine/openaiaccounts.chatgpt-driver-2338.test.js`: replace each byte-identical local
  `waitFor` loop with a thin wrapper over `eventually()`. These are the (c)-poll reds in Mona's
  list (the two OpenAI sign-in tests, 4 s budget).
- `eventually-5727.test.js` (new): node test. Pins scale=1 when the var is unset (Liu's required
  test), the floor, the ceil scaling, and `eventually`'s return/throw behaviour, all by call
  count not wall time so the test does not itself join the flaky class.
- `tools/test-time-scale-5727.sh` (new) + wired into `package.json` `test:shell`: pins the
  floor, the 4x cap, the knee, and the fail-safe of the scale math.

## Guardrails (m4867)
Compute once at run start; log in the banner; floor 1; cap 4x; a test pinning scale 1 when
unset; never shorten a timeout. All present.

## What "done" looks like for PR-1
- New helper + scale land; at scale 1 (CI / unloaded) every migrated budget is byte-identical
  to before, so no assertion is lowered.
- The two migrated files pass; the new node + shell tests pass; the whole suite passes.
- Validation: the repo helper (`run-or-skip`) on the committed HEAD, plus CI green by name.

## Weakest part (named)
Scaling a budget up can mask a real PERFORMANCE regression (work that takes 2x but still
finishes); it cannot mask a true HANG (never finishes, times out at any scale). Acceptable
because these are liveness budgets with slack, not perf guards; a perf guard must not use the
helper. Full convergence across the whole class is later PRs, not this one.
