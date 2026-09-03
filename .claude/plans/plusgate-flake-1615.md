# Plan: de-flake render-plus-gate-1615.js (blocks the 0.6.27 cut)

## Problem
The 0.6.27 release cut refused at step 3b (page gate): `render-plus-gate-1615` went red.
Reproduced standalone: it FLAKES ~50% (run 1 clean, run 2 red, same tree). NOT a product
regression -- the Plus enrolled flow renders fine (light-enrolled passes); under the cut's
load both themes fail. Plus is a separate surface from the install-flow fix (#2073/#2080)
this cut is for.

## Root cause (a race in the CHECK)
`openPlus(page, remote)` runs twice on the SAME page (unenrolled then enrolled). Two bugs:
1. Its settle `waitForFunction` returned as soon as "exactly one of state1/plus-flow is
   visible" (an XOR). paintPlus reads /api/remote asynchronously; during the LOADING window
   state1 is up while plus-flow is still hidden -- which satisfies the XOR -- so the assert
   raced the paint and read the stale unenrolled state.
2. `page.route('**/api/remote')` STACKS a handler each call rather than replacing it.

## Fix
- Wait for the SPECIFIC expected state per scenario (enrolled -> plus-flow up AND state1 gone;
  unenrolled -> state1 up AND plus-flow gone), passing `remote.enrolled` into waitForFunction.
  This closes the loading-window race without a fragile fixed sleep.
- `page.unroute('**/api/remote')` + `page.unroute('**/api/remote/devices**')` before
  re-stubbing, so only the current scenario's stub answers.

## Verification
8 consecutive standalone runs all pass (was ~50% flake). The assertions are unchanged, so the
check still guards the same behaviour (unenrolled hides the switch; enrolled shows the switch).

## Why this matters
It de-flakes every future cut's page gate, and unblocks the 0.6.27 re-cut carrying the
install-flow fix Josh is waiting to test.
