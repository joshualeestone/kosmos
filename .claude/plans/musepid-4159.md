# musepid-4159: the hard-cap muse test reads a pid only once it is real (kosmos#4159)

## Problem
Round 1's test was fixed for a loaded machine, but its sibling, "the hard cap alone stops a running muse", still read its pid file unconditionally with a 300 ms cap. Under load the file can be missing, which throws, or empty, and Number('') is 0, so process.kill(0, 'SIGKILL') would hit the test's own process group.

## Call
Move round 1's retry into one helper, `turnThatStarted`, and use it in both tests.

## Rejected
Copying the loop, or raising the cap: a bigger cap only makes the race rarer, and the test would wait longer.

## Weakest premise
The fix is reasoned from the code plus a forced case (cap of 1 ms, which reaches the "did not run" message). The original flake was never reproduced on the second test.
