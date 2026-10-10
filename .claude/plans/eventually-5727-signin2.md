# Plan: eventually-5727-signin2 (#5727 follow-up 1, batch 2)

## Scope (Liu m4885)
Batch 2 of the follow-up that migrates the remaining (c) poll-until-deadline copies onto the
shared `eventually()` helper (PR-1 #5738), per-directory, byte-identical at scale 1, small for
one sitting. Batch 1 (#5745) did the provider sign-in `waitFor` helpers; batch 2 does the two
`engine/` sign-in `until(fn, ms, what)` helpers that share one shape:
- `engine/musesignin.test.js` -- `until(fn, ms=15000, what)`, 100ms step, throw embeds
  `what` and `signin.status()`.
- `engine/agysignin.test.js` -- `until(fn, ms=20000, what)`, 200ms step, throw embeds `what`.

## Change
Each `until` becomes a thin wrapper over `eventually(fn, (v) => v, { timeoutMs: ms, stepMs,
describe })`. The `while (Date.now() < end)` loop is replaced; at scale 1 the budget equals `ms`
and the behaviour (resolve when `fn()` is truthy, fail at `ms`) is equivalent, with ONE
difference worth stating plainly: the old `while (Date.now() < end)` loop checked the deadline
BEFORE probing, while `eventually` probes then checks, so it makes one extra probe past the
deadline. A success that lands within one poll step after `ms` therefore passes instead of
failing. That is strictly MORE lenient, never stricter (a never-true condition still times
out), so no assertion is weakened and no failure is masked; it is not literally byte-identical,
unlike the probe-then-deadline helpers in batch 1. The old throw carried a `what` label (and,
for muse, `signin.status()`); that diagnostic is preserved through `describe`, so a timeout
failure still names what was awaited. The helper signature `until(fn, ms, what)` is unchanged,
so no call site changes.

## counts-before-and-after
Before: each file had 1 `until` with 2 `Date.now()` uses (the `end` and the `while`), 0
`eventually` require. After: 0 `Date.now()` in each (loop gone), 1 `eventually` require and 1
`eventually()` call each; the `until` signature and every call site unchanged.

## Throw-text independence
Verified: the only `timed out waiting for` matches are the throw sites inside `until`
themselves (musesignin:60, agysignin:57 on main); no assertion reads them.

## What "done" looks like
- Both files pass at scale 1 (equivalent, one step more lenient) and at a forced scale.
- Whole suite green on CI by name; Sonya reviews.

## Weakest part (named)
Two small, named deviations from strict byte-identity, both in the lenient direction: (1) the
one-extra-probe-past-the-deadline above, and (2) the throw text changes to `eventually`'s form
(the `what`/state detail preserved via describe). Neither can weaken an assertion or mask a
failure (a never-true condition still times out; nothing reads the throw text). If a future
test began asserting on the throw text, it would surface as a red, not a silent pass. Flagged to
Liu, since the one-step leniency applies to every `while (Date.now() < end)` loop in later
batches, not just these two.
