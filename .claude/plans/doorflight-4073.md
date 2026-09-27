# doorflight-4073: the #1618 shelf test waits for the verifier instead of sleeping 150ms (#4073, #4066)

## Why

`server.doorflight-1618.test.js` "two callers asking for the shelf at once verify each door ONCE" failed
under machine load (3 of 6 full validations on 2026-09-26 per the card, and the only red in 5 of mine the
same evening, at load 47 to 74), always with `during = 0`, and passed alone every time. It started two
fetches, slept a fixed 150ms, then asserted exactly one verify. Under load neither request had reached
the verifier by then, so it read 0 and reported "not shared". The clock, not the defect.

## The change (the test file only)

- `until(ok, ms = 5000)`: poll every 10ms until a condition holds or the deadline passes.
- Test 1 waits until the verify count reaches 1, then holds `SECOND_VERIFY_MARGIN_MS` (300ms) so a
  second, unshared verify has time to show, then asserts exactly 1. A 0 at the deadline fails with a
  message that says it is a slow machine, not a sharing defect.
- Test 2 ("forget() observes its OWN write") had the same fixed 150ms wait for its read to be in
  flight; it now waits with `until` too.
- Both gated tests release the held reads in `finally`. Before, a failed assert left the two held
  requests open and the file hung (measured: over 3 minutes until killed).

## Proofs (each restored after)

- Sharing broken (`readConnectionsShelf` without `inflight.collapse`): test 1 red, `during = 2`.
- A slow machine (the verifier's count lands 400ms after entry): the new wait passes 4/4; the exact old
  shape (a 150ms sleep, no margin) fails test 1, as the flake did, and now in 2s rather than hanging.
- Unmodified: 4/4, three times.

## Weakest premise

The 300ms margin is how long an unshared second verify gets to appear. On a machine slow enough that the
second read takes longer than 300ms after the first to reach the verifier, a sharing defect would be
missed on that run (a false green), not reported falsely. It errs toward passing; the sharing arm is also
covered at a quiet time by every other run.
