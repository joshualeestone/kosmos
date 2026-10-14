# cappercontrol-6048: the #5331 CONTROL arm released under load (got 0)

Card: kosmos#6048 (recurrence 2026-10-14 01:50, CI job 115702676926, PR #6135). Test-only: tools/test-queued-heavy-4977.sh.

## Cause (read from the code and the job's own log)
- side5331 stopped the capper, then ended the command (KILL of `sleep U+3`), THEN sent the wrapper TERM.
- Ending the command lets the wrapper leave `wait "$CMD"` and run the teardown in its main flow. In the control copy that
  is the old teardown: a group KILL that misses (the capper is not a group leader) and `wait "$CAPPER"` on a stopped
  capper. A side turn traps TERM (`exit 143`), and bash cuts a `wait` short to run a trapped signal's handler. So a TERM
  landing while the old teardown already sat in that wait interrupted it; the EXIT trap's teardown (TERM ignored there)
  then ran again and ... released: the job log shows the control's side turn starting 06:22:07 and its wrapper gone by
  06:22:08, "got 0".
- Which came first, the TERM or the teardown's wait, was scheduling: a quiet box usually sent TERM before the wrapper
  reached the wait (hold), a loaded runner sometimes after (release). The main arm ran the same sequence, so its pass
  was partly the same race.

## Change
- side5331 sends TERM FIRST, while the wrapper is still in `wait "$CMD"` (the command runs on). TERM interrupts that
  wait; the teardown then runs only from the EXIT trap, where TERM is ignored, so nothing can cut it short: the old
  teardown holds for good, the new one releases. The command is ended by the teardown itself (its own group, set -m
  inline at the launch survives the copies' sed), and any sleep left over is KILLed after the reap.

## Decided, not missed
- Weakest premise: that the release came from the TERM interrupting the old teardown's wait. Read from bash's trap
  semantics and the log's one-second timeline, not reproduced on the hosted runner. If the control reds again with this
  order, the race is elsewhere and its "got" line says which shape (0 released, 1 held, 2 never started).
- The arms' bounds (main 30 s, control 15 s) are unchanged.

## Tests
- tools/test-queued-heavy-4977.sh focused, twice (queued): 142 OK each, the control held (got 1) both times.
