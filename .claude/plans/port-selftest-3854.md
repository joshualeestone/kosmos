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
- tools/test-app-port-selftest.sh: QUICK_T=30 for the four answering arms; T=2 stays for the two hanging
  arms (their 124 is under test). A quick answer returns when it exits, so the longer bound costs nothing
  on an idle Mac.

## Measured
- On main's test with the answering stub made to take 3s (standing in for a loaded start): 3 FAIL, the
  card's two plus the CURRENT arm. The same stub on this branch: 0 FAIL. Unmodified branch run: all pass.

## Decided
- Test-only; bounded_run and its real callers are unchanged (rejected: a finer poll inside bounded_run,
  which would change product code to fix a test's bound). Weakest premise: that nothing else in the
  test waits on another process; the reproduction shows the bound alone accounts for the card's failure.
- Card offered to Baron Draxum (the test's author) first; his session could not answer.
