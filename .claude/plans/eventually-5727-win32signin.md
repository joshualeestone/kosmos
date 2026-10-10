# Plan: eventually-5727-win32signin (#5727 follow-up 1, batch 4)

## Scope
Batch 4 migrates `engine/connect.win32signin.test.js`'s `until(fn, ms)` poll helper onto the
shared `eventually()` helper. One helper, 30 call sites. This is the first of the two
big-call-site connect files (the other, `connect.test.js` with ~90 sites, follows as its own
batch). The DIFF is one helper body; the work is the per-call-site polarity audit below.

## Change
The old `until` was a `setInterval(..., 10)` loop that probed, resolved on truthy, rejected a
thrown `fn()` (`reject(e)`), and at the deadline rejected
`'condition never became true; state: ' + JSON.stringify(connect.state())`. It becomes a thin
wrapper over `eventually(fn, (v) => v, { timeoutMs: ms || 3000, stepMs: 10, describe })`.

- Throw propagation preserved: the old loop rejected a thrown `fn()`; `eventually` awaits the
  probe, so a throw propagates the same way. No swallow wrapper (unlike batch 3's hookwiring).
- 10ms step and the `ms || 3000` default preserved.
- Diagnostic: `describe` LEADS with `connect.state().phase` (Sonya's tip for a readable red) and
  then keeps the whole state the old throw dumped, so the compound waits that key on `because` /
  `url` (e.g. lines ~449, ~468) still show those fields on a timeout red. Nothing asserts on the
  throw text.

## Equivalent at scale 1, one extra probe at t=0 (strictly more lenient, positive-only)
`setInterval(fn, 10)` fires FIRST at t=10ms; `eventually` probes at t=0. So `eventually` checks
once sooner (an extra early probe), which can only make a positive wait succeed sooner. It is
strictly more lenient and never stricter. This is safe here ONLY because every call site is a
positive wait (see the audit); it is the same "never stricter for positive waits" rule as the
while-loop family (Liu m4894), applied to the setInterval form.

## Polarity audit (per Liu m4894) -- all 30 call sites POSITIVE
Every `await until(...)` call waits for a phase (or a spawn/kill count) to be REACHED, then the
test proceeds; a timeout fails the test. None proves an absence, none is wrapped in
`assert.rejects` or a catch-as-success, none expects the timeout. The three `try` blocks that
contain an `until` (around lines 241, 296, 420) are `try { ... await until ... } finally {
connect.cancel()/clearInterval }` -- try/FINALLY cleanup, NOT catch-as-success. Representative
sites: `phase() === SIGNIN_AWAITING_CODE/STUCK/CONNECTED/SIGNIN_BROWSER_OPEN/SIGNIN_COMPLETING`,
compound `STUCK || CONNECTED`, and `ctx.spawns[0].child.killCalls >= 1`. So no call site is
pulled off `eventually()`.

## counts-before-and-after
Before: 1 `until` (setInterval deadline loop), 30 `await until(...)` call sites, 0 `eventually`
require. After: 0 setInterval in `until`, 1 `eventually` require, 1 `eventually()` call; the
`until(fn, ms)` signature and all 30 call sites unchanged.

## What "done" looks like
- The file passes at scale 1 and at a forced scale; whole suite green on CI; Sonya reviews.

## Weakest part (named)
The t=0 extra probe is safe only because all the call sites are positive; the audit is the
load-bearing step, so if a future negative use of `until` were added to this file it would need
its own helper. The describe leads with the phase (readability) and keeps the full state after
it (completeness), so nothing in the old diagnostic is lost; and nothing asserts on the text, so
no behaviour depends on it.
