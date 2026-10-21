# forgetflake-6770: the keyed-start Forget test checks order, not wall-clock time (kosmos#6770)

## What was wrong
`engine/remote.test.js` "kosmos#5422: a keyed start that never returns cannot hold a Forget" asserted a FIXED 700 ms bound
on a Forget whose key-call wait is 200 ms, against a fake start that busy-waits 800 ms from its first line. It failed
twice on 2026-10-20 on the self-hosted kosmos-ci-agent1s runner (this Mac; NOT hosted CI, as the card says), jobs
118814039338 and 118845006455. Read from the logs (CORRECTED in review 2; my first version misquoted them):
- the assertion's own numbers: Forget took **1742 ms** and **789 ms** (968 and 2040 were whole-test durations);
- both runs: `wall-clock test time-scale 1.00x`, load 3.45 and 4.36 on 10 cores. The "4.00x, load 15.6 on 5 cores" I first
  quoted came from another PR's log (#6762), not these.
So it was not heavy CPU load, and 789 ms sits inside the window a Forget that waited out the 800 ms start would land in.

## Measured on this Mac before changing anything
- 11 runs, none failed (alone, alone under 24 busy processes, the whole file under load, through tools/run-tests.sh):
  Forget 216 to 275 ms. Same hardware as the runner, so CPU load is not what reproduces it.
- The code path: with nothing enrolled, nothing in forget()/forgetNow() waits on the start except the bounded
  deviceIdInFlight race. Not explained: the 1742 ms run (longer than the start) and the 789 ms run. One unmeasured
  candidate (review 2): forgetNow's two write() calls fsync, so disk contention could stall them; a load scale cannot
  see that.

## Call: assert ORDER, not time
The fake start in a new mode word `devkey-hang-start` SLEEPS (Atomics.wait, no CPU) for 3000 ms and then appends
`["start-done"]` to the record. The test asserts that when forget() resolves there is NO start-done record:
- a Forget that waited out the start ALWAYS sees start-done (fails at any load);
- a Forget that was only slow (a stalled write) passes unless its stall outlasts the whole 3 s start.
`await starting` moved into `finally`, so a red never leaves the sleeping start running into the next test (review 2).
`devkey-slow-start` is unchanged for the test before it, which needs the start to finish.

## Rejected
- A fixed or scaled wall-clock bound (my first version, scaleBudget(700)): CI ran at 1x, so it changed nothing there,
  and a bound cannot tell a slow Forget from one that waited for the start (review 2, BLOCKER).
- Loosening the bound: past 800 ms it passes a Forget that waited out the old start.

## Weakest premise
That the reds were slowness and not a real race in which Forget waits for the start. NOT shown: 789 ms is consistent
with a real wait. This change does not hide such a race: if it exists, the test fails with start-done seen, now with a
clean signal (order) instead of a timing one. If it fails again on CI, that is a real Forget defect, not a flake.

## Tests
- Real code: pass. Whole file: 239/239.
- MUTANT, Forget waits out the start (key-call wait 60 s): red, "Forget waited out the whole start (3064 ms; the start
  sleeps 3000 ms)".
- MUTANT, a Forget slow by 1800 ms (about the slower CI red) but not waiting for the start: PASSES, the point of the change.
- Cost: the test takes about 3 s instead of about 1 s.

## Review round 1 (blind, sonnet): no issues
- Verified: the start outlasts the bound by 1500 ms at every scale (eventually.js clamps 1 to 4); passes at 1x (2.6 s)
  and 4x (4.7 s); no mode-word collision (exact word match, like devkey-slow); env cleaned in finally; Atomics.wait is
  allowed on node's main thread and already used in the repo; no guard reads remote.test.js or forbids the pattern.
- [NIT] an unset FAKE_HANG_START_MS would be NaN, an infinite wait --> FIXED: `|| 3000`.
- [NIT] the test takes about 2.6 s instead of 1 s --> NOT CHANGED (the documented cost).

## Review round 2 (blind, opus): BLOCKER, fixed
- [BLOCKER] the plan misread both CI logs (scale 1.00x, not 4x; Forget 789 and 1742 ms, not 968 and 2040), so the
  scaled bound changed nothing on CI --> FIXED: the evidence corrected above, and the test now asserts order (a
  start-done record) instead of wall-clock time.
- [WARNING] "cannot hide a race" overstated what the change shows --> FIXED: the weakest premise now says the 789 ms
  run is consistent with a real wait, and that a repeat red means a real defect.
- [NIT] on a red the sleeping start outlived the test --> FIXED: await starting in finally.
- [NIT] inconsistent durations in the plan --> FIXED (about 3 s now).

## Review round 3 (blind, sonnet): converged
- No issues found. Verified the escape matches the line-40 record write, recorded() parses ["start-done"], the
  mutant fails (3153 ms on its own copy), start-done can only exist if the 3 s start ended before Forget resolved,
  setupRun never rejects so `await starting` cannot hang, and the CI numbers in this plan match both logs.
