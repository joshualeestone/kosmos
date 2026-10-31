# turnlive-7674: a relay push between two of its steps reads as a live build (kosmos#7674)

## Problem
`kosmos_prepush_build_live` saw a relay pre-push build only while it held `machine.lock`, which it does during one cargo
step. Between two steps the build held no lock, so a queued heavy run (`_qh_clear`) could claim the box in that gap
and the build stopped at its next step ("Mortals is now claimed ... stopping", 96), after the builder's whole wait.

## Design (option (d) on #7674, held for Sonya's agreement on #6756)
- Live = the lock held (as before) OR the build's gate turn file, `prepush.gate.turn` beside the lock, touched within
  `KOSMOS_PREPUSH_TURN_LIVE_S` (180 s: the hook's 120 s grace plus a margin). The hook touches the turn at every step
  boundary and removes it when its gate ends or on any red.
- The turn path is derived from the lock path, so one seam moves both (tests; run-tests.sh's /dev/null path).
- `kosmos_refuse_if_prepush_build_live` says "between two of its steps" and the turn's age when only the turn is live.
- No relay change. Only the callers that already wait for a build see the extra time: queued-heavy's `_qh_clear` and a
  cut's waits. `run-tests.sh` suites never check for a build, so ordinary suites are unaffected.

## Rejected
- (a) Every push holds a suite-queue place for its gate: every later `yarn test` would wait out every push gate.
- (b) The push's steps wait on a claim between steps: more relay complexity, and it has to tell which run queued behind.

## Weakest premises
- A turn left by a build that died reads as live for up to 180 s, so a heavy run or a cut waits that long.
- A heavy run can now get in only BETWEEN two gates, not between two steps. If pushes hand the turn straight to each
  other (the next queued push takes it within one 10 s lock slice), a heavy waiter behind a long stream of pushes can
  reach its queue bound. Before this change it got in between steps, by stopping the push (the bug). Accepted because
  the room's Mortals line hands over by message, with minutes between gates, and a heavy run that hits its bound says so
  and can be queued again. If that stops being true, the next step is giving a waiting heavy run the turn between gates.
- The gate lock is also held for an instant by a queued push answering "wait" in its turn loop. It counts only while a
  turn is on file (a real checkout writes its turn first), so a queue of waiting pushes with no turn reads as no build.
  With a lapsed turn left on file, a waiter's instant holds 0.3 s apart can still read as one, until a waiter takes the
  turn over (within its next pass).
- The window follows KOSMOS_PREPUSH_TURN_GRACE + 60 only where that variable is set in the environment cut-guard reads.
  A grace raised only in the hook's own environment on Mortals leaves the window at 180 s, and a build idle between
  steps for longer reads as none.

## Verification
- tools/test-prepush-wait-6756.sh arm 10 (fresh, old, empty, future-dated and missing turns; the refusal wording;
  `_qh_clear`; the /dev/null seam; the gate lock with and without a turn; the window and the grace). A mutant that
  drops the turn check was run by hand on a copy (not part of the suite) and failed arm 10.
- tools/test-cut-guard.sh, test-queued-heavy-4977.sh, test-light-side-4911.sh.
