# psflake-6222: the #5532 Windows PowerShell check flakes on a busy runner

## Finished looks like
engine/computerprint-5532.test.js passes on the self-hosted Windows runner under normal load, and the timing
dependence that made it flake is named and removed from what the test measures.

## What the logs show
PR #6221's Windows job (run 38725050291, attempt 1): the test "this PC's real print exists, is stable, and PowerShell
reads the same value" failed at 10057 ms (the whole test; the existence checks and two reg.exe reads take about 57 ms)
with "the PowerShell fallback read a different value, or none". Production's POWERSHELL_TIMEOUT_MS is 10000, so the
real PowerShell read ran out of time (start-up or run; a timeout does not say which) (the read returns null on a
timeout, so the print is missing, not different). The #6202 failure ran with a win32-kosmos-shell-5358 ETIMEDOUT in
the same job, which also points at a loaded runner.

## The call
The test asks whether PowerShell reads the SAME value as reg.exe, not how fast PowerShell starts. `_testRunner` (tests
only) takes `fallbackTimeoutMs`; with `fallback: 'real'` the real production read runs with that wait. The test passes
25000: worst case with both earlier reads at their limits is 15 + 15 + 25 = 55 s, under tools/windows-tests.js'
60 s per-test cap with room (which may not fire on a synchronous test at all) and far inside its 20 minute file cap. Production's 10 s wait is unchanged.

## Rejected
- Raising production's POWERSHELL_TIMEOUT_MS: the read is synchronous and can hold the board; a slow read on a user's
  PC already retries after a backoff (RETRY_AFTER_FAIL_MS), and the self-hosted runner's load (other jobs on that machine;
  tools/windows-tests.js runs files one at a time) is not a user's PC.
- KNOWN_RED: the test is green on main most of the time; it is flaky, not broken.
- Copying the PowerShell command into the test with a longer timeout: it could drift from what production runs.

## Weakest premise
That the failures are start-up time and not a wrong value. The 10057 ms duration on the #6221 failure supports it;
the #6202 failure's duration was not read (its run is no longer listed for the branch).

## Verify
Windows CI on the PR, rerun to several consecutive greens. Locally (Mac): the file and the Windows guard tests pass;
the win32 test itself is skipped here.

## Review 1 (opus), and what changed
- Fixed: a fallbackTimeoutMs that is not a positive whole number now throws in _testRunner (a typo or a string would
  otherwise fall back silently to production's 10 s, and a quiet runner's green would look like the fix). Tested on
  every platform.
- Comment and plan: the 45 s is this read's; with the two earlier reads the test stays under the 60 s cap (worst case
  about 55 s). The 10057 ms is the whole test. The runner runs files one at a time.

## Review 2 (sonnet), and what changed
- Fixed: the wait is 30 s, not 45 s: with both earlier reads at their limits (reg.exe 5 s then PowerShell 10 s, twice)
  the test is at most 60 s, the runner's per-test cap.
- Fixed: a test proves the wait reaches the real read (a fresh copy of the module with execFileSync intercepted:
  30000 with the option, 10000 without), on every platform.
- Fixed: the option is validated before anything is swapped, and refused unless fallback is 'real'.

## Review 3 (opus), and what changed
- Fixed: the wait is 25 s (worst case 55 s), so there is room under the 60 s per-test cap, and the comment no longer
  relies on that cap firing (a synchronous test body may not be interruptible by it; the 20 minute file cap bounds it).
- With no wait, the fallback is readPowerShell itself again, so a restore matches a fresh load.
