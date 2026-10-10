# Plan: eventually-5727-connect (#5727 follow-up 1, batch 3)

## Scope
Batch 3 migrates `engine/connect.hookwiring-1569.test.js`'s `until(fn, ms=8000)` poll helper
onto the shared `eventually()` helper from PR-1. One file, one helper, two call sites.

This file is chosen as a clean, byte-identical batch. The larger connect polls
(`connect.test.js` ~90 `until()` call sites, `connect.win32signin.test.js` ~33, both the
`setInterval` form) each get their OWN carefully-audited batch later: the DIFF there is still
tiny (one helper body), but the polarity audit scales with call-site count and must be done
with full attention.

## Change
`until(fn, ms=8000)` becomes a thin wrapper over `eventually()`. The old loop was a
`setTimeout`-tick that probed FIRST and checked the deadline AFTER (like batch 1's `waitFor`),
so at scale 1 it is byte-identical: 20ms step, resolve on the first truthy `fn()`, fail at
`ms`. Two details are preserved exactly:
- The old tick SWALLOWED a throwing `fn()` as not-ready (`try { ok = fn() } catch { ok = false }`).
  `eventually` would propagate a probe throw, so the probe is wrapped
  `() => { try { return fn(); } catch { return false; } }` to keep the swallow behaviour.
- The 20ms step and the 8000ms default.
Only the throw TEXT changes to `eventually`'s form, and no assertion reads it (the only
`timed out waiting` matches are a comment and the throw site itself).

## Polarity audit (per Liu m4894)
Both call sites are POSITIVE waits:
- `connect.hookwiring-1569.test.js:165` `await until(() => connect.state().phase === DOWNLOADING)`.
- `:186` `await until(() => (connect.state().progress || {}).got > 0)`.
Neither proves an absence, is wrapped in `assert.rejects`, or expects the timeout. (And this
helper probes-then-checks, so there is no extra-probe leniency here regardless.)

## counts-before-and-after
Before: 1 `until` with a `Date.now() - t0 > ms` deadline, 0 `eventually` require.
After: 0 `Date.now()` deadline in `until`, 1 `eventually` require, 1 `eventually()` call; the
`until(fn, ms)` signature and both call sites unchanged.

## What "done" looks like
- The file passes at scale 1 (byte-identical) and at a forced scale. Whole suite green on CI;
  Sonya reviews.

## Weakest part (named)
The swallow-exceptions behaviour. If the wrapper's try were dropped, a throwing predicate would
fail the test immediately instead of being treated as not-ready; the try preserves the old
contract. The two call sites' predicates do not throw in practice (guarded member access), so
this is belt-and-braces, but it keeps the helper's contract intact for any future call site.
