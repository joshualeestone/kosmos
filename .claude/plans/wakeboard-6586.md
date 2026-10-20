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
- Iteration 4 (a WARNING and a NIT: a state reached during the wait other than unreachable, such as a busy board under
  reclaim, a stranger, or our board bound and silent, fell to the stuck refusal instead of its first-look verdict):
  cmd_start's guards now sit in a loop that runs a second time after the wait, which itself runs once. Every state
  then gets exactly the first look's verdict, and iteration 3's copied unreachable block is gone. The loop body keeps
  its old indentation because other tests lift and pin those lines. The reviewer's probe held the port unbound in its
  wait arm but bound in its control; the test's version binds it in both and differs only in when. Measured: five
  first-look-versus-during-the-wait pairs equal, and removing the `continue` turns 8 cases red.
- Iteration 5 (a WARNING and a NIT): the wait was keyed on "waited once", so a board launchd relaunched in place of
  one that exited during the wait was called stuck after no looks at all (measured by the reviewer: control rc 0, race
  rc 1). The wait is now keyed on the recorded pid, at most two per start, so the loop stays bounded. The exit line no
  longer promises a start before the guards run again. Every first-look pair now also asserts its verdict text, not
  only that the arms agree. New cases: the relaunch race against its control; a board replaced again and again (two
  waits, then the stuck refusal); a silent board's exact look count (33). Both mutants (back to a flag; no cap) red.
- Iteration 6 (a WARNING and two NITs, all in the test): a stand-in board killed inside a command substitution stayed
  a zombie of the outer shell, and a zombie answers kill -0, so the exit could go unseen (the reviewer measured 1 flake
  in 25 runs). Stand-ins are now orphaned at once, so launchd reaps them, and a kill waits until the pid is gone. The
  EXIT trap ends any left. The cap test also asserts the two exits it relies on. Measured: 30 of 30 runs green, no
  orphaned stand-ins left, both mutants still red.
- Iteration 7 (a WARNING and a NIT):
  - WARNING, fixed: a `kosmos stop` (or an update's pause) that ended the board during the wait was undone, because
    rc 2 led to a launch. Now a stop marker present after the board's exit means the stop wins and nothing is
    launched: a plain start returns 0 and says so; a reclaim caller, which asked for a running board, gets a failure.
    The marker stays. Tested for both, mutant red, 15 of 15 runs green. A stop that writes its marker but has not yet
    ended the board leads, as before, to the stuck refusal once the wait runs out.
  - NIT, accepted and recorded here: the worst case is longer than "30 looks" suggests. Under KOSMOS_RECLAIM_BUSY=1, a
    board that binds and stays busy during the wait does not end it (busy is not success for a reclaim), each look can
    cost a 2 s probe plus 0.5 s, so one wait is up to about 77 s; with the second pass's busy retry (up to 20 s), a
    second wait if the pid changed, and the #3079 reclaim plus its own bring-up, one start can take roughly 250 to 270
    s, under the desktop app's 300 s limit. Rejected: ending the wait at the first busy reading under reclaim. That
    matches the first look's verdict exactly, but in the card's own case (setup.sh's put-back while launchd brings the
    new board up) it would reclaim, that is kill, a freshly relaunched board that is only booting. Weakest premise:
    that a booting board answers busy rather than down for most of its boot; if it reads down, the cost is moot.
- Iteration 8: NO NEW FINDINGS (converged at 563f6d6f).
- Mortals full suite at 563f6d6f: 22342 node tests, 0 failed, but one shell assertion of this card's own test failed:
  the silent board's look count came back empty (''). It read the count from an EXIT trap inside the subshell
  cmd_start dies in. NOT reproduced: alone on Mortals 20 of 20 green and 8 in parallel green, at home 10 of 10 green
  with the runner's environment and through shell-shard's own `sh -c` spawn. The cause is unknown. The count now
  rests on a file each look appends to, which does not depend on how the subshell ends, and a mismatch prints the
  start's own words, so a recurrence explains itself. Mutant (29 looks) red with that output.
