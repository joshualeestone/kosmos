# cappercontrol-6048: the #5331 CONTROL arm reported "got 0" on CI (2026-10-14 01:50)

Card: kosmos#6048 (CI job 115702676926, PR #6135). Test-only: tools/test-queued-heavy-4977.sh.

## What is known (from the job's own log)
- The CONTROL's log ends at "SIDE TURN: running c5331" with no "claim released": its teardown did not finish, so this
  was not the old teardown releasing. The test shell printed "line 508: <pid> Killed: 9 ... c5331" just before: a c5331
  wrapper was SIGKILLed.
- reap() returns 0 ("exited in time") whenever ps does not name this shell as the wrapper's parent, which an EMPTY ps
  answer (a busy runner) also reads as. That, or a never-started first attempt whose KILL notice printed during the
  retry, fits a 0; neither is proven.

## Rejected (review 1)
- My first cause (a TERM interrupting the old teardown's wait) is wrong: the EXIT trap reaches the same uninterruptible
  wait, and a bash 3.2 replica held under every timing. The reorder built on it was reverted.

## Change: the next red says which shape it was
- reap() records REAP_HOW (notours with the ppid ps gave, exited, killed) and REAP_RC (the wrapper's exit status where
  wait got one). The notours branch does not wait (the wrapper may still be ours and running).
- side5331 appends to <marker>.why: each attempt and its wrapper pid, why an attempt never started (no side turn, an
  empty capper look, a STOP that did not show and the stat it showed), the capper's stat just before the reap, and how
  reap decided with the exit status.
- The CONTROL's BAD prints the control's log, whether the teardown said "claim released", and that record, LAST
  (review 2: ok() printed only the last 6 lines of $o; it now takes OTAIL, 200 for this arm and reset after). The
  exited branch records the raw ps stat (an empty answer reads as exited too), and an exit status of 127 says it was not
  this shell's child.

## Decided, not missed
- No behaviour of the arms changes; this is diagnosis, and the card stays open to catch the next recurrence with its
  shape (as Angel left it for the previous one).
- Weakest premise: that the next red will show one of the recorded shapes; a cause outside them still prints the log.

## Tests
- tools/test-queued-heavy-4977.sh focused (queued): results recorded here once measured.
