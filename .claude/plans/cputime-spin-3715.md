# cputime-spin-3715: the cpu-time helper's units test spins on CPU time, not wall time

Follow-up to #3715 (mine, PR #3730). `test-support.cpu-time.test.js`'s units test spun for 40ms of WALL time
and asserted the helper read at least 1ms of CPU. On 2026-09-25 at 15:00, with two full suites running on this
Mac, it read 0.867ms and failed a validation run on an unrelated branch (which-room-3224). It passes alone.

## Change
The spin is bounded by CPU time (`process.cpuUsage` reaching 40,000 microseconds), with a 5s wall cap so a
broken clock cannot hang the suite. The assertion (1 to 3000 ms) is unchanged.

## Why it still tests the units
The spin uses the raw microsecond counter, the helper converts. Measured: the helper returning seconds
(`/ 1000000`) or microseconds (`/ 1`) turns the test red; the real helper passes.

## Weakest premise
The flake is not reproduced here: 10 parallel CPU hogs did not starve the old test (8 of 8 green). The fix is
reasoned from the failure's own number (0.87ms of CPU in 40ms of wall), which is what a wall-bounded spin
reads when the process is not scheduled. The new test passed 5 of 5 under the same hogs.
