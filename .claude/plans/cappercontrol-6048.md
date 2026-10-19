# cappercontrol-6048: the #5331 CONTROL arm reported "got 0" on CI (2026-10-14 01:50)

Card: kosmos#6048 (CI job 115702676926, PR #6135). Test-only: tools/test-queued-heavy-4977.sh.

## What is known (from the job's own log, review 3's reading)
- The CONTROL's log ends at "SIDE TURN: running c5331" with no "claim released": its teardown did not finish, so this
  was not the old teardown releasing.
- There was no retry: the test shell's "line 508: 19953 Killed: 9 ... c5331" notice and the main arm's OK are 30 ms
  apart. Bash prints a dead background job's notice at the next top-level line or external command, and a KILL reaped
  by reap()'s own wait would name a line inside the function: so the control's wrapper was SIGKILLed by something during
  or just after its side turn, bash reaped it in the background, and reap()'s first ps found nothing (notours, ppid ''),
  returning 0 at once. Who sent the KILL is not identified: none of the test's own KILLs in that window target it.

## Rejected (review 1)
- My first cause (a TERM interrupting the old teardown's wait) is wrong: the EXIT trap reaches the same uninterruptible
  wait, and a bash 3.2 replica held under every timing. The reorder built on it was reverted.

## Change: the next red says which shape it was
- reap() records REAP_HOW (notours with the ppid ps gave, exited, killed) and REAP_RC (the wrapper's exit status where
  wait got one). The notours branch does not wait while the wrapper is alive; it waits when it is gone, which is bounded.
- side5331 appends to <marker>.why: each attempt and its wrapper pid, why an attempt never started (no side turn, an
  empty capper look, a STOP that did not show and the stat it showed), the capper's stat just before the reap, and how
  reap decided with the exit status.
- The CONTROL's BAD prints the control's log, whether the teardown said "claim released", and that record, LAST
  (review 2: ok() printed only the last 6 lines of $o; it now takes OTAIL, 200 for this arm and reset after). The
  exited branch records the ps stat (an empty answer reads as exited too), and an exit status of 127 says it was not
  this shell's child.

## Review 3 (opus)
- notours now says alive or gone, and for a gone wrapper waits (bounded: it is dead) to record its exit status (137 for
  a KILL), so the likeliest shape reads as itself, not as a ps flake on a live wrapper.
- The record notes the wrapper's and the capper's stat before the TERM (taken before the sleep KILL, so the window
  that existed is not widened), and how many "claim released" lines the log had right after the reap (before the
  capper is KILLed, after which a misread wrapper could still release). The bound branch says "not ours" when it sent
  no KILL.

## Decided, not missed
- No behaviour of the arms changes; this is diagnosis, and the card stays open to catch the next recurrence with its
  shape (as Angel left it for the previous one).
- Weakest premise: that the next red will show one of the recorded shapes; a cause outside them still prints the log.

## Tests
- The full validation runs tools/test-queued-heavy-4977.sh in its shell shards; its result is the measurement (a
  separately queued focused run was dropped as redundant). A green CONTROL there is one observation, not proof the
  rare red is gone: this change does not claim to remove it.
