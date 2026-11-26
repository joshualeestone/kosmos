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
