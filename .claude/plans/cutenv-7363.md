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
- Stripping the 3b page layer's environment as well: the card names the suite, and 3b already runs under its own env
  exclusion (#2724); widened only if a 3b test is shown to read a KOSMOS_CUT_*.

## Proof
tools/test-cut-suite-env-7363.sh: the helper lifted from release.sh and run under /bin/bash 3.2 with set -u (a sentinel
KOSMOS_CUT_* and two real ones never arrive; a non-prefixed KOSMOS_* does; none exported still runs), and both step-3
suite lines pinned to it. Mutation-proven: an unwrapped serial call, stripping one name only, and the plain-array form.

## Weakest premise
That no test in the suite NEEDS a KOSMOS_CUT_* from the cut. None should (the suite tests the tree), and the full
validation run will show it; a test that did would have been reading the operator's environment, which is the defect.

## Review rounds
