# forgetflake-6770: the keyed-start Forget test holds under CI load (kosmos#6770)

## What was wrong
`engine/remote.test.js` "kosmos#5422: a keyed start that never returns cannot hold a Forget" asserted a FIXED 700 ms bound
on a Forget whose key-call wait is 200 ms, against a fake start that busy-waits 800 ms. It failed twice on 2026-10-20,
both on the self-hosted kosmos-ci-agent1s runner (NOT hosted CI, as the card says), runs 39476221845 and 39485513321:
Forget took 968 ms and 2040 ms. Both runs logged "wall-clock test time-scale 4.00x" (load 15.6 on 5 cores in one).
The bound sat 100 ms under the start's own length, so any stall near a second read as "waited out the whole start".

## Measured before changing anything
- Alone, unloaded: 3/3 pass. Alone under 24 busy processes on 12 cores: 8/8, Forget 218-227 ms.
- Whole file under the same load: 4/4, 216-229 ms. Through tools/run-tests.sh --only: 3/3, 220-275 ms.
- Not reproduced on this machine (11 runs). The code path was read: nothing in forget()/forgetNow() waits on the start
  except the bounded deviceIdInFlight race; in the 2040 ms run Forget outlasted the start (1419 ms in the previous test),
  so it is not tied to the start's end. Read as load.

## Call
- The bound is `scaleBudget(700)` (the suite's load factor from tools/run-tests.sh, capped at 4x): 700 ms unloaded,
  2800 ms at 4x.
- The fake start for this test is a new mode word `devkey-hang-start` that SLEEPS (Atomics.wait) for
  FAKE_HANG_START_MS = bound + 1500, so it always outlasts the bound by 1.5 s at any scale and adds no CPU load of its
  own (the old 800 ms busy-wait burned a core during the measurement). `devkey-slow-start` is unchanged for the test
  before it, which needs the start to finish.

## Rejected
- Loosening the fixed bound alone: past 800 ms it would pass a Forget that waited out the whole start (vacuous).
- Scaling the bound without lengthening the start: at 4x (2800 ms) the 800 ms start ends first, same vacuity.
- A fixed long start (5 s): costs 4 s every run at scale 1.

## Weakest premise
That both reds were load and not a real race in Forget. Not reproduced here. If a race exists that makes Forget wait for
the start, this test still fails on it (the start outlasts the bound at every scale), so the change cannot hide it.

## Tests
- Real code: pass at KOSMOS_TEST_TIME_SCALE 1 and 4.
- MUTANT (Forget's wait set to 60 s, so it waits out the start): red at scale 1 (2370 ms, bound 700, start 2200) and at
  scale 4 (4458 ms, bound 2800, start 4300).
- engine/remote.test.js whole file: 239/239.
- Cost: the test now takes about bound + 1.5 s (2.2 s at scale 1) instead of about 1 s.
