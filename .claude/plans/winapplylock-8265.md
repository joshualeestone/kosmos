# winapplylock-8265: the test's exclusive holder retries its open

Card: kosmos#8265. engine/win32apply.test.js goes red intermittently on the Windows job with "the holder never held
the file", in "BUG 1: a real exclusive handle on the update lock inside the rollback".

## What the card guessed, and what the logs say
The card's first guess was a time limit under a slow runner (the file took 362 s and 438 s on the failing runs). The
Windows job of PR #8220 ran the same file green in 438 s, so those durations are normal for it, not slow. In the job that
failed at 362 s, a file that starts a PowerShell for each of 54 arms ran in 28 s, so PowerShell was starting promptly.

## The cause, as far as it can be seen from here
holdExclusively's PowerShell makes ONE attempt: [IO.File]::Open(file, Open, Read, None). FileShare.None fails at once if
anything else has the file open at that moment. The script then ends, and the test polls 30 s for a hold that can no
longer come. Measured with pwsh on this Mac: while another process holds the file, the old one-shot form dies with a
MethodInvocationException, and the retrying form gets the hold once it is free. The lock file is freshly written just
before the hook, which is when a scanner on a Windows runner would have it open.

## The call
The holder's script retries the open every 50 ms for up to 25 s, inside the test's existing 30 s wait. Test-only; no
product code. Nothing else in the three holdExclusively callers changes.

Rejected: raising the 30 s limit (it waits on a script that has already ended, so more time buys nothing).

## Weakest premise
What held the file open on the runner is inferred, not observed: the log has only the final error. The test is
WINDOWS_ONLY, so it cannot run here; the Windows CI job is its check. If the red recurs with this change, the retry
ran 25 s against something holding the lock throughout, and the next step is to log what the open threw.
