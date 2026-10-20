# wakeboard-6586: `kosmos start` waits for a board that is starting, before calling it stuck (kosmos#6586)

## What this branch does
- install/kosmos `cmd_start`: a recorded board that is alive but not answering used to end the start at once ("already
  running ... but is not answering", then the installer's "Something went wrong"). It now gets `_await_recorded_board`
  first: the same bounded wait a fresh start gets (`_await_board_up`, 30 looks), and is a success if it answers.
- tools/test-start-waits-for-starting-board-6586.sh (in test:shell).

## Decisions
- Every recorded live board gets the wait, not only one "younger than this run's pause" (the card's wording): the CLI
  does not know the installer's pause time, and a wedged board only costs the bounded wait before the same message.
  Rejected: reading the board's age from ps (one more platform-dependent parse for no change in outcome).
- The wait is its own short loop (iteration 1), not `_await_board_up`: this board was not launched by this command, so
  nothing may signal it (only `kill -0`, a probe) or speak of launching it. Busy counts as up for a plain start but
  never under KOSMOS_RECLAIM_BUSY=1 (the watchdog's or the app's reclaim already judged it stale); unreachable from
  this shell ends the wait at once; a board that exits while starting returns 2, and cmd_start clears its pidfile
  and goes on to a normal start instead of dying about a dead pid.
- Weakest premise: that the slow board in the card was launchd's put-back starting up (as the card measured: it
  answered /api/health 200 within ~20 s). A board that takes longer than the wait still gets the old message.

## Proof
- `bash tools/test-start-waits-for-starting-board-6586.sh`: 10 PASS (sources the real CLI; healthy and sleep stubbed).
  Mutants red: the wait removed from cmd_start; a pid passed to the wait.
- Neighbours green: test-kosmos-addr-reclaim-3079 (20/20), test-board-foreground-2956, test-stopmark-6651,
  cli.startedby-5450.test.js (9/9). No test pins the old message.
- Iteration 1 (a WARNING, NITs; mutants red: busy under reclaim, the exit check, the unreachable stop): see the
  wait's decision above. Callers checked by the reviewer: the watchdog ignores the exit code, the native app allows
  300 s, the installer has no timeout, restart cannot reach this branch with a lingering board.
- Iteration 2 (NITs only): the new function moved above _await_board_up's doc comment (it had split them); one last
  look after the loop (a board answering at the very end is up); an unreachable board's stuck message uses
  _unreachable_lead/_unreachable_why; a comment records that a fall-through after rc 2 reuses the guards checked before
  the wait. Accepted: under a reclaim (KOSMOS_RECLAIM_BUSY=1) a recorded board that answers UP during the wait is a
  success, as it is for any start (busy is not); a slow-binding OLD build cannot be told apart here without a build
  check, which is out of this card. The last two test assertions read source order, not behaviour (the loop itself
  is tested by behaviour).
- Iteration 3 (two WARNINGs against iteration 2's unreachable die, a NIT): a board that turns unreachable DURING the
  wait now gets exactly the verdict cmd_start gives one unreachable at its first look (#4636): a plain start says it
  is already running and returns 0; a reclaim, or a board that is not ours, restores the stop marker and refuses with
  the same sentence. Measured with the reviewer's two probes (wait arm against the control, plain and
  KOSMOS_RECLAIM_BUSY=1): rc and the marker now match. The busy success gives the person the busy hint, as the other
  busy paths do.
