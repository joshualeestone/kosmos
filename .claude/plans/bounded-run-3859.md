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
route. So after a grace (10 x `sleep 0.2`, measured about 3.3s), the group and the leader get SIGKILL. The
grace watches the GROUP, not the leader (review 2): a leader that dies on TERM can
leave a child that ignores it, still holding the port.

A test seam, `KOSMOS_BOUNDED_RUN_SETPGRP_DELAY`, holds perl before `setpgrp` so
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
  124 within a 20s watchdog, and within 4s. The measured TERM path is 2.3 to
  2.6s. With steps 2-3 removed, KILL alone took 5.6s. So the ceiling is what keeps
  steps 2 and 3 visible now that step 4 exists.
  - Old kill: `HUNG-20s`.
  - Steps 2-3 removed: fails the ceiling.
- **A bundle that ignores SIGTERM:** must return 124. With step 4 removed it
  reports `HUNG-20s`.
- **A bundle whose child ignores SIGTERM while the leader dies on it:** the child
  must be gone. With a leader-only grace it is left orphaned.
- **Nothing leaked**, after each arm.

The rc file each watched arm polls for is written to a temporary name and moved
into place, so the poller can never read it half-written.

**Not measured:** step 3's own window, perl forking between steps 1 and 2. It is
microseconds wide and no test hits it.
