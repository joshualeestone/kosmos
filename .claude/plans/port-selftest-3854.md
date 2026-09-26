# Plan: #3854, the port self-test flakes under load (124 on a quick command)

## Finished looks like
tools/test-app-port-selftest.sh passes on a loaded Mac: the arms where a bundle ANSWERS get a bound that
starting a process under load cannot exceed, and the arms where a bundle HANGS still time out at 2s.

## Why
Ice Cream Kitty measured 5 pass / 1 fail at load 7-12, and it failed two unrelated full validations.

## Cause (read, then reproduced)
Every arm used one bound, T=2. bounded_run polls `kill -0` once a second and kills at waited >= 2, so a
quick command has about 2s of wall time for perl setpgrp + bash to start the stub and answer. Under load
that is exceeded: 124 with empty stdout, the card's two FAILs. The same starvation hit "a CURRENT bundle
is #910-aware" (expects 0), and it could let the two BEHIND answer arms (exit / wrong port, expect 1) pass
for the wrong reason, a timeout instead of the answer they test.
Real use is unaffected: tools/test-install.sh passes ${KOSMOS_SELFTEST_TIMEOUT:-10}.

## Change
- tools/test-app-port-selftest.sh: QUICK_T=30 for the answering arms; the two hanging arms keep a short
  bound (their 124 is under test), raised from 2s to 5s in review round 3. A quick answer returns when it exits, so the longer bound costs nothing
  on an idle Mac.

- Review round 1: the hanging arm's reap check passed with nothing to reap when the kill landed before
  the stub forked (a launcher-only-kill regression went green with a slow fork). The stub now writes a
  marker once it has forked; if a 2s run misses it, the arm runs once more at 10s, and it FAILS rather
  than passes without the marker. The BEHIND answering bundles are also run raw, asserting rc 0 and their
  answer, so their premise arms fail on the answer, not a timeout. The first quick answer is timed against
  a ceiling below QUICK_T (two-thirds of it), the one check that catches a bound always waited out; the
  other QUICK_T arms are not timed. wait_gone polls up to ~20s.
- Review round 2: the reap line now reports "never-forked" (a FAIL) when the marker is missing, instead
  of a PASS for a reap never exercised. Baron Draxum (the test's author) asked for a control that the
  quick arm hands back the command's own nonzero rc and stdout, not 124: a stub that prints "broke" and
  exits 3 must come back as 3:broke (a bounded_run that drops the rc fails it, measured).
- Review round 3: the hanging arms' bound is 5s, not 2 (the same 124, and a slow start is much less likely
  to miss the fork or to hit the #3859 setpgrp window, which would HANG the test rather than fail it);
  the timing ceiling is derived from QUICK_T so it cannot be silently disarmed; the rerun bound is named.
  Re-measured: a bound always waited out and a launcher-only kill both still fail.

## Measured
- On main's test with the answering stub made to take 3s (standing in for a loaded start): 3 FAIL, the
  card's two plus the CURRENT arm. The same stub on this branch: 0 FAIL. Unmodified branch run: all pass.
- Hanging stub delayed 3s before its fork: passes (via the 10s rerun). The same plus a launcher-only kill
  in the lib: 2 FAIL (the reap and the no-leak checks); before round 1 it passed.

## Decided
- Test-only; bounded_run and its real callers are unchanged (rejected: a finer poll inside bounded_run,
  which would change product code to fix a test's bound). Weakest premise: that nothing else in the
  test waits on another process; the reproduction shows the bound alone accounts for the card's failure.
- Not here: bounded_run can hang if its bound expires before perl's setpgrp (product code, found in
  review round 1). Filed as #3859. Residual in this test until then: a Mac starved for more than 5s
  before perl's setpgrp would hang the self-test (a stuck CI job at its 30-minute cap), not fail it.
- Card offered to Baron Draxum (the test's author) first; his session could not answer.
