# intbound-9115: the #8890 Ctrl-C arm's exit bound has room for the CI Mac (kosmos#9115)

## Measured
- The failure (run 45759855120, job 139707312233): the Ctrl-C arm took 90581 ms against scaleBudget(90000); the inner
  run had printed its whole end (allowlist note, #4273 LEAK line, machine block), so it was finishing, not stuck.
- Passing CI runs of the same arm (suite (node) jobs 139670083866, 139674257730, 139685454484, 139706905318):
  53.7 s, 37.4 s, 89.8 s, 49.1 s. The TERM arm in those runs: 3.6 to 24.3 s.
- This Mac, the same file alone, twice: Ctrl-C arm 5.6 s and 5.7 s, TERM 0.7 s (load ~6 on 10 cores).

## Change
- tools.run-tests-stubsweep-8890.test.js: the Ctrl-C/TERM exit bound 90 s -> 240 s, scaled, with the measurements in
  the comment.

## Decisions
- Raise the bound. Rejected: making the Ctrl-C wind-down faster. Why it is 7 to 16 times slower on the CI Mac is
  unknown, and a passing run already reached 89.8 s, so the bound had no headroom whatever the cause.
- Weakest premise: that the CI slowness is contention and not a slow path that is getting worse. A runner that never
  exits still fails, at 240 s instead of 90 s. If a later run passes the new bound's half (120 s), that is the
  signal to look at the wind-down itself.

## Review round 1 (00:01): no blocker, two should-fix, fixed
- The race's timer was never cleared, so the file idled the whole bound after its tests passed (reviewer measured
  240.9 s for ~12 s of tests). Fixed: clearTimeout once the race is decided.
- With a 240 s bound, a runner that IGNORED the signal could still pass the Ctrl-C arm: the fixture's test ended on
  its own after 120 s, the run ended normally and the leak guard's line satisfied the regex. Fixed: one
  EXIT_BOUND_MS, and the fixture waits twice that.
- NIT left: the 30 s spawnSync took 17.8 s on one CI run (one data point; watch).

## Cause found, filed separately (#9117)
- The wind-down is the leak guard walking EVERY process in a bash loop: 11.6 s and 11.3 s for 1,139 processes at
  load ~17 here; a hand-timed Ctrl-C run was silent from 8.2 s to 23.4 s. main's own Ctrl-C arm took 86 s here at
  00:0x (5.7 s at 20:xx). The bound stays raised whatever #9117 does.

## Review round 2 (00:12): no blocker, one should-fix, fixed
- The fixture's wait is baked with the OUTER run's time scale, while the inner run computes its own; at an outer
  scale above 2.5x the inner one, the inner per-test limit (600 s x inner scale) could end the fixture inside the
  bound and reopen the ignored-signal false pass (reasoned). Fixed: env() hands the inner run
  KOSMOS_TEST_TIMEOUT_MS = 4 x EXIT_BOUND_MS, which run-tests.sh takes as given (tools/run-tests.sh:573).
- NIT fixed: the bound's comment rewrapped to 120 columns.
- Measured: the file, 3 of 3, 29 s wall, equal to node's duration (no idle tail).

## Review round 3 (00:16): CONVERGED, no blocker, no should-fix
- Checked: the KOSMOS_TEST_TIMEOUT_MS value is chosen by the test, not leaked from the runner (RUNNER_SET strips the
  outer one first); 960000 to 3840000 passes run-tests.sh's validation; the inner per-file limit (>= 1800 s) cannot
  end the fixture inside the bound (<= 960 s). Measured on this Mac: 3 of 3, TERM 10.0 s, Ctrl-C 73.1 s, 102 s wall,
  equal to node's duration.
- NITs left: env() reads EXIT_BOUND_MS, defined below it (safe: env() runs only after load); the 30 s spawnSync has
  one 17.8 s CI data point.
