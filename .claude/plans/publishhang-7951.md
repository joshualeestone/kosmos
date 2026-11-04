# publishhang-7951: bound the node calls in publish-r2.ps1

Card: #7951. A prod promote from Git Bash sat 10 minutes holding publish.lock: the manifest check's node had printed its passing verdict and never exited. Closing stdin got through.

## Change
- `Invoke-NodeBounded`: node runs through System.Diagnostics.Process with stdin redirected and closed, stdout and stderr drained, and a limit (300 s; a test seam exists only under the fake bucket).
- Both node call sites use it: `Invoke-WinManifest` and the verification-record verdict.
- A run that reached no answer (stopped, output never closed, did not start) refuses as "decided nothing", never as "does not check out", and never counts as a pass even if it printed one.
- Every other refusal names the exit code.

## Decisions
- **Call:** a hung check that printed PASS still refuses. Rejected: trusting the printed verdict, because a killed process has no exit code and the printed line is not the decision.
- **Rejected:** Start-Job, whose child inherits a different world and costs a second PowerShell; `$null | & node`, which closes stdin but gives no limit.
- **Limit 300 s:** the check took 4 s by hand. Well below the 35 minutes after which -BreakLock can take the lock.

## Weakest premise
The hang is not reproduced. It needs Windows with Git Bash holding stdin. On this Mac the tests show stdin reaches EOF while pwsh's own stdin stays open, and a node that hangs is stopped. If the real cause is not stdin, the time limit still bounds it to 5 minutes and names it, but the promote would keep refusing until the cause is found.

## What would change my mind
A Windows run where the hang survives closed stdin, or a real check that legitimately passes 300 s.

## Git
Git gets a closed stdin as well, because the stated mechanism (a child inheriting Git Bash's stdin) applies to any child. No time limit on git: rejected as scope, since nothing has seen git hang, and Get-SetupAtCommit reads raw bytes through its own stream. If git hangs, this card's symptom returns with no message. A follow-up should bound it.

## Where this is measured
tools.win-publish-node-bounded-7951.test.js runs the real functions in CI's windows job under powershell.exe and pwsh, including Windows argument rules, and prints whether the old form hangs with a stdin held open there. The bash suite covers the gates, on pwsh only.

## Not measured
The hang on the release PC itself, launched from Git Bash.
