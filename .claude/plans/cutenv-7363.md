# cutenv-7363: release.sh step 3 runs its suite with every KOSMOS_CUT_* removed (kosmos#7363)

## Why
A cut's own operator overrides reached step 3's suite twice (KOSMOS_CUT_CHANNEL at 0.7.25, KOSMOS_CUT_LINUX at
0.7.71: 9 reds, cut aborted), because tests that run a nested release.sh obey them. Each was fixed by unsetting that one
variable. Six more are read and never unset (KOSMOS_CUT_NO_WHATS_NEW, _IGNORE_PREPUSH, _IGNORE_SIDE, _IGNORE_HARNESS,
_LIVE_HOME, _NEW_TMUX), plus the tuning ones (_PARALLEL, _PREPUSH_WAIT_S, _RENEW_MAX, _RENEW_SECS).

## The change
`cut_suite_env` in tools/release.sh runs a command with every exported KOSMOS_CUT_* removed (by prefix, so a variable
added later is covered), and both step-3 suite runs (the serial one and the backgrounded one of the parallel 3+3b path)
go through it. The release.sh process itself keeps them: they are this cut's settings, and only the suite must not see
them. `${a[@]+...}` keeps an empty list safe under set -u on macOS bash 3.2.

## Rejected
- Unsetting the variables in release.sh before step 3 (the #7340 shape): some are read after step 3 (KOSMOS_CUT_PARALLEL
  decides the path itself; the renew settings run all cut long), so they cannot be unset in the cut's own shell.
- A list of names: it is the per-variable shape that let each new one through; the prefix closes the class.
- Stripping the 3b page layer's environment as well: 3b reads no KOSMOS_CUT_* (none in tools/browser-checks.sh or
  docs/browser-checks, checked in review 1), and runs no nested release.sh; widened only if that changes.

## Proof
tools/test-cut-suite-env-7363.sh: the helper lifted from release.sh and run under /bin/bash 3.2 with set -u (a sentinel
KOSMOS_CUT_* and two real ones never arrive; a non-prefixed KOSMOS_* does; none exported still runs), and both step-3
suite lines pinned to it. Mutation-proven: an unwrapped serial call, stripping one name only, and the plain-array form.

## Weakest premise
That no test in the suite NEEDS a KOSMOS_CUT_* from the cut. None should (the suite tests the tree), and the full
validation run will show it; a test that did would have been reading the operator's environment, which is the defect.

## Review rounds
1. (default, 14:5x CDT) 0 BLOCKERs, 1 WARNING, 2 NITs; all applied.
   - (W) step 3's isolation rerun (#2006, kosmos_isolation_rerun_verdict, which decides whether a red suite stops the
     cut) re-ran tests in the cut's own environment, KOSMOS_CUT_* included: the same leak one call down. It now runs as
     `$(cut_suite_unset; kosmos_isolation_rerun_verdict ...)`, which clears them in that subshell only (test pins the
     call and runs the helper; mutation-proven).
   - NIT: the call-site pin matches the wrap's shape (`cut_suite_env [nice -n 19 ]yarn test >"$_suite_log"`), so a fake
     wrap (`cut_suite_env true && yarn test`) reds it (mutation-proven).
   - NIT: the plan's 3b reason now says what was checked (3b reads no KOSMOS_CUT_* and runs no nested release.sh).
   - The reviewer checked: nothing the suite needs is stripped (self-exclusion uses KOSMOS_MACHINE_CLAIM_COOKIE and
     KOSMOS_RUN_COOKIE_*, run-tests.sh reads no KOSMOS_CUT_*), env finds the same yarn/nice, and 126/127 still reach the
     "could not run" branch.
2. (sonnet, 15:0x CDT) 1 BLOCKER, 1 WARNING, 2 NITs; the BLOCKER and WARNING applied.
   - (B) tools/test-cut-parallel-region.sh runs step 3's region verbatim, and the region now calls cut_suite_env and
     cut_suite_unset, defined outside its markers: 4 FAILs on this branch (main 0). The test now lifts both helpers
     from release.sh verbatim (not stubbed) and sources them before the region: FAILS: 0. My sweep had covered the new
     test and the release tests, not the test that RUNS the region; a sweep of all 52 shell tests naming release.sh
     followed.
   - (W) cut_suite_unset cannot clear a readonly exported name or one no shell can name (env -u can): the comment says
     so. Nobody exports such a KOSMOS_CUT_*.
   - NITs left: the call-site pin counts `yarn test >"$_suite_log"` lines only (a new suite run with another redirect
     would not be counted); the first grep -q '^}$' checks either function's closing line.
