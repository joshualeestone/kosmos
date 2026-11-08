# winapplylock-8265: the test's exclusive holder retries its open

Card: kosmos#8265. engine/win32apply.test.js goes red intermittently on the Windows job with "the holder never held
the file", in "BUG 1: a real exclusive handle on the update lock inside the rollback".

## What the card guessed, and what the logs say
The card's first guess was a time limit under a slow runner (the file took 362 s and 438 s on the failing runs). The
Windows job of PR #8220 ran the same file green in 438 s, so those durations are normal for it, not slow. In the job that
failed at 362 s, a file that starts a PowerShell for each of 54 arms ran in 28 s, so PowerShell was starting promptly.

## The cause, as far as it can be seen from here
holdExclusively's PowerShell made ONE attempt: [IO.File]::Open(file, Open, Read, None). FileShare.None fails at once if
anything else has the file open at that moment, and the one opener the code guarantees is the helper's own poll, which
opens the lock with fs.readFileSync every 50 ms from the moment the child starts. A failed .NET call does not end a
PowerShell script: it went on to its long sleep holding nothing (measured with pwsh), and the test ran out its wait.

## The call
One shared script (holdScript) for the holder and the skip probe, which had the same one-shot open and could silently
skip both tests. It retries the open every 50 ms for up to 25 s. It writes how far it got to a state file in the
sandbox ("started, no hold yet", "held", "no hold in 25 s"), and the failure names that and the last read, so a
recurrence can be told apart: never started, no hold in 25 s, or something else. The wait is 75 s (HOLD_WAIT_MS),
to leave room for the file's documented stall of about 34 s plus the 25 s retry. Test-only; no product code.

Measured with pwsh, from the generated script: with the file free and an apostrophe in its path it records "held";
with another process holding the file throughout, it records "no hold in 25 s".

## Weakest premise
What collided with the open on the runner is inferred, not observed: the old log has only the final error. The poll
is the likeliest. The test is WINDOWS_ONLY, so it cannot run here; the Windows CI job is its check. If the red recurs,
the new message says which case it was.

## Review round 1
Corrected: the failed open did not end the script (it slept holding nothing); the guaranteed opener is the poll, not a
scanner; the probe needed the same retry; a recurrence needed to say which case it was; the wait now covers a stall.

## Review round 2
The wait was 60 s against a stated 34 + 25 s, a margin of 1 s; it is 75 s now. "Never started" now means the state file
is absent, not merely unreadable.
