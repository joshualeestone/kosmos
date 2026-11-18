# ctrlc-8681: the "Ctrl+C is not held off" case measures the gap, not a wall clock (kosmos#8681)

## The card
`tools.win-publish-node-bounded-7951`, "Ctrl+C is not held off by the limit, and takes node with it", went red three
times on 11-17 under load (15.9 s to stop against a fixed 15 s) and passes alone.

## What "held off" means, read from the code
`Invoke-ChildBounded` (tools/windows/publish-r2.ps1) waits in 250 ms slices because PowerShell cannot act on Ctrl+C
during one blocking .NET wait. If that were lost, pwsh would act on Ctrl+C only when the node limit ran out. So the
failure looks like "stopped at the limit", and the success looks like "stopped soon after SIGINT".

## Decided
- The harness's node limit goes from 40 s to 600 s (CTRLC_LIMIT_S), and the time allowed to stop goes from 15 s to
  120 s (STOP_ALLOWED_MS), with the SIGKILL fallback at that same 120 s. A held-off Ctrl+C now needs 600 s, so the
  allowance can be generous for a loaded Mac and still separate the two cases by a factor of five.
- The assertion also fails when the fallback had to kill pwsh, and says "Ctrl+C was held off" in that case.
- The 20 s wait for node to start becomes 120 s (START_ALLOWED_MS): a pwsh start alone took 17 s on CI's loaded Mac
  (#7998), the same fixed-clock class.
- A MEASURED line prints the stop time, so a slowing trend shows in logs before it goes red.
- Rejected: a control process stopped in the same run (the card's alternative). It measures how loaded the box is,
  but the 600 s gap already makes load irrelevant, and a second pwsh doubles the cost of the slowest case in the file.

- **A failed run cleans up after itself** (review 1). The case's own failure path (pwsh SIGKILLed by the fallback)
  skips pwsh's finally, so node was orphaned with no limit; three such nodes were found on this Mac (one from my first
  perturbation, two 13 days old) and stopped. The test's finally now kills a pwsh still running and the node by its
  pid, only when that pid's command line still names the run's own pid file (a pid is reused once node is gone).
  This runs after the assertions, never instead of them.
- A pwsh that dies at start is named at once ("exited before node started"), and a pwsh already gone at SIGINT
  fails instead of reading as an instant stop (review 1).

## Measured
- Alone on this Mac: pwsh stopped 459 ms after SIGINT; the whole file passes (4 pass, 1 skipped as win32-only).
- Perturbed: replacing the 250 ms slices with one wait for the whole remaining limit (Ctrl+C held off) turns the case
  red at 121 s with "it was still running and was killed, so Ctrl+C was held off". Restored afterwards.
- Perturbed again after the cleanup: red the same way, and no node left running (before it, one was).
- Worst passing case is 240 s (start plus stop), under run-tests.sh's 600 s per-test timeout.

## Weakest premise
That 120 s covers the worst load the self-hosted Mac sees. Tonight's worst sighting was 15.9 s, so the margin is
about 7x; a box loaded far beyond tonight could still reach it, and then the red names the measured time.

## What would change my mind
A sighting near 120 s under load. Then the right move is a relative bound against a control process, not a bigger
number.
