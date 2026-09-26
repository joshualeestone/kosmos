# bounded-run-3859: bounded_run returns 124 even when the bound beats setpgrp

Card: kosmos#3859. Found by the #3854 review.

## Problem

`bounded_run` (tools/lib/app-port-selftest.sh) kills `-- -$pid`, the process group
perl creates with `setpgrp`. If the bound expires before perl has run `setpgrp`, no
group exists yet, so the kill does nothing. The bare `wait` then blocks while perl
goes on to exec a bundle that never exits. The result is the #955 hang, not a 124.

## Decision

Kill in three steps: the group, then the leader, then the group again.

- If there was no group yet, perl has forked nothing, so killing the leader is
  enough.
- The second group kill covers perl reaching `setpgrp` and forking between the
  first two kills.

The card suggested `group || leader`. That leaves exactly that window open, so it
was not used as written.

Then, from review 1, a fourth step. All the kills are SIGTERM, and a bundle that
traps or ignores TERM would still hang the `wait`, the same #955 shape by another
route. So after a grace (10 x `sleep 0.2`: about 2s nominal, 3.3s on Agent1s where
starting a program is slow), the group and the leader get SIGKILL. The
grace watches the GROUP, not the leader (review 2): a leader that dies on TERM can
leave a child that ignores it, still holding the port.

Both test seams (below) are honoured only with `KOSMOS_BOUNDED_RUN_TEST=1` beside them
(review 5), so a value left exported in a shell cannot change a real run. A test seam,
`KOSMOS_BOUNDED_RUN_SETPGRP_DELAY`, holds perl before `setpgrp` so
the self-test can hit the window on purpose. When unset it costs nothing.

**Rejected:**
- `set -m`, where bash sets the pgid in both parent and child at fork, so the
  window disappears. It changes job-control state in a library that callers
  source, and it prints job notices.
- A fixed sleep before the kill. That only narrows the window.

**Weakest premise:** step 3's window, perl forking between steps 1 and 2, is
microseconds wide and is not exercised by any test. It is argued, not measured.

## Tests

`tools/test-app-port-selftest.sh` gains four arms, each red-checked in a scratch
copy with its own fix removed:

- **The bound beats setpgrp:** a 6s seam delay with a 2s bound. It must return
  124 within the watchdog, and it must have been ended by TERM, not by step 4's
  KILL. A test-only file, `KOSMOS_BOUNDED_RUN_HOW_FILE`, records which signal
  ended it. An earlier time ceiling did this job, but review 4 showed it passed
  without steps 2-3 on a normal Mac, where the grace is shorter than on Agent1s.
  - Old kill: `HUNG-20s`.
  - Steps 2-3 removed: the file says `kill`.
  - The TERM-ignoring arm asserts `kill`, which is the control that the file can
    say it.
- **A bundle that ignores SIGTERM:** must return 124. With step 4 removed it
  reports `HUNG-20s`.
- **A bundle whose child ignores SIGTERM while the leader dies on it:** the child
  must be gone. With a leader-only grace it is left orphaned.
- **Nothing leaked**, after each arm.

The rc file each watched arm polls for is written to a temporary name and moved
into place, so the poller can never read it half-written.

**Not measured:** step 3's own window, perl forking between steps 1 and 2. It is
microseconds wide and no test hits it.
