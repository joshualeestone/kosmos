# Plan: eventually-5727-remote (#5727 follow-up 1, batch: engine/remote.test.js)

## Scope
Migrates the three hand-rolled (c) poll-until-deadline constructs in `engine/remote.test.js`
onto the shared `eventually()` helper. One PR, one file (the `engine/` directory). My notes
flagged this file as the nuanced one, so it is handled alone rather than bundled.

The three constructs:
1. `until(check, what, ms = 5000)` -- a COUNT-based loop (`for (i < ms/25)`), probe then
   sleep 25ms, `assert.fail('timed out waiting for ' + what)` at the deadline. ~70 positive
   call sites.
2. `setupSent()` -- inline `const until = Date.now() + 5000; while (Date.now() < until) { if
   (pred) return; await sleep(25) }`, `throw new Error('fixture: the setup was never sent')` at
   the deadline.
3. `registerSent()` -- the same inline `while (Date.now() < deadline)` shape, waiting on the
   `signin`/`register` record, `throw` at the deadline.

## Change
Each helper keeps its signature and all call sites; only the body is replaced:
- `until`  -> `await eventually(check, (v) => v, { timeoutMs: ms, stepMs: 25, describe })`
- `setupSent` / `registerSent` -> `await eventually(pred, (v) => v, { timeoutMs: 5000,
  stepMs: 25, describe })`
Plus one `const { eventually } = require('../test-support/eventually');`. Nothing else changes.

The old `until` ended in `assert.fail`; `setupSent`/`registerSent` ended in `throw`. `eventually`
throws on timeout, so the throw-on-timeout semantics are preserved. The error TEXT changes to
`eventually`'s prefix, but each `describe` carries the old diagnostic ('timed out waiting for
<what>', 'fixture: the setup/register was never sent'), and nothing asserts on the text.

## Equivalence: two cases, because `until` was count-based (this batch's key nuance)
All three old loops probe at t=0 FIRST (the count loop's i=0 iteration; the `while (Date.now() <
deadline)` loops check before the first sleep), exactly as `eventually` probes at t=0. So there
is NO t=0 shift (unlike the setInterval form in batch 4), and the 25ms step is preserved. But the
deadline semantics split:

- **`setupSent` / `registerSent` (already WALL-CLOCK `while (Date.now() < deadline)`):** truly
  byte-identical at scale 1, plus `eventually`'s one extra probe past the deadline, which for a
  positive wait can only let a success land that the old loop would have failed: strictly more
  lenient, never stricter (Liu m4894).
- **`until` (COUNT-based, `ms/25` fixed iterations) -> WALL-CLOCK:** NOT byte-identical, a
  deliberate refinement, and the first count-based helper in the #5727 sweep. The old count
  loop's real duration stretched with per-iteration lag (accidentally load-adaptive, but
  UNBOUNDED -- a 15000ms wait could run for minutes on a very slow box). `eventually` gives an
  explicit deadline scaled by KOSMOS_TEST_TIME_SCALE (runner-computed, capped at 4x). Under the
  runner the scaled budget tracks the load the count loop adapted to by accident, now BOUNDED; at
  scale 1 on an unloaded box the real durations match. The only case where the new path is
  STRICTER than the old count loop is a bare `node --test` (scale 1) on a LOADED box -- the exact
  scenario this sweep targets, and the suite runs via the runner. This surfaced in the blind
  challenge pass (below); it is why `until` is called out here rather than filed as a pure
  refactor.

## Polarity audit (per Liu m4894) -- every call site POSITIVE
All 80 `await until(...)` sites (plus two arrow-wrappers, `failed`/`waiting`, that return
`until(...)` and are awaited at their own call) wait for a state to be REACHED
(`remote.status().state === 'up'` / `'restarting'`, a `recorded()` entry to appear,
`remote.read().vouched[id]` to be noted, a count to grow), then the test proceeds; a timeout
fails the test. The `setupSent()` (1) and `registerSent()` (8) sites likewise wait for a record
to appear. None is wrapped in `assert.rejects`,
none is a catch-as-success, none expects the timeout. The only `.catch` in the file (on
`remote.signinStart(...)`) is unrelated to these helpers. So no call site is pulled off
`eventually()`.

## Deliberately NOT touched
- The `const until = Date.now() + N; while (Date.now() < until) {}` busy-waits INSIDE the fake
  CLI subprocess string (the generated `kosmos-remote` script, lines ~70-371): these simulate a
  slow/hung external command. They are the system's simulated latency, not a test-side condition
  poll, and must keep their fixed durations.
- The (a)-family `assert.ok(Date.now() - t0 < N, ...)` elapsed-bound asserts (e.g. "Forget
  waited out a hung register", "a hung signed call was not ended by its bound"): discriminating
  timing bounds, not (c) waits, left intact and NOT scaled.

## counts-before-and-after
Before: 3 hand-rolled poll bodies (`until` count loop; `setupSent`/`registerSent` Date.now
while-loops), 0 `eventually` require. After: 1 `eventually` require, 3 `eventually()` calls (one
per helper body), 0 Date.now-deadline loops in the three helpers; the three signatures and every
call site byte-identical; the fake-subprocess busy-waits and the (a) asserts untouched.

## What "done" looks like
- The file passes at scale 1 (identical to main's 216/216/0 baseline) and at a forced scale;
  whole suite green on CI by name; Sonya reviews.

## Weakest part (named)
Two weak points, named honestly:

1. **The count->wall-clock change for `until` is a behavioural change, not pure equivalence.**
   Under a bare `node --test` at scale 1 on a loaded box it is STRICTER than the old count loop
   (fewer probes before giving up). It is sound because the suite runs via the runner, which sets
   the scale, and the change also BOUNDS a previously-unbounded hang. But it is a real semantic
   shift, so Sonya should weigh whether a count-based helper belongs in the sweep or should keep
   its count semantics; I judged the bounded-scale version an improvement.
2. **The polarity audit must be COMPLETE** across every site (80 `await until`, 2 arrow-wrappers,
   1 `setupSent`, 8 `registerSent`): one missed negative use (a test expecting one of these to
   time out) would be made stricter by the extra probe. I enumerated every site and the blind
   pass re-enumerated independently; all positive.

Engine-tick/async-interleaving sensitivity (the axis that kept `engine/connect.test.js`
hand-rolled) is low here: the helpers probe at t=0 with a 25ms step unchanged, so cadence is
preserved, and no migrated helper carries a discriminating timing bound. Still, I ran the whole
file on-branch (scale 1 and scale 4) before trusting it, because a clean polarity audit did not
prove connect.test.js safe.
