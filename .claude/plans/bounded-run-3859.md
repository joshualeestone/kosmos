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
route. So after about 2s of grace, the group and the leader get SIGKILL.

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

`tools/test-app-port-selftest.sh` gains an arm: a 4s delay before `setpgrp` with a
2s bound. It must return 124 within a 20s watchdog, and nothing may leak.

- Against the old kill (steps 2 and 3 removed, in a scratch copy), the arm reports
  `HUNG-20s` and the suite fails.
- With the fix, all checks pass.

A second arm uses a stub that ignores SIGTERM. It must return 124 under the same
watchdog. With step 4 removed (scratch copy) it reports `HUNG-20s`.

The rc file each arm polls for is written to a temporary name and moved into
place, so the poller can never read it half-written.
