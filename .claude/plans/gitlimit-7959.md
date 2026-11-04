# #7959: a time limit on publish-r2.ps1's git calls

Addresses #7959.

## What finished looks like
A git that hangs during a stage or promote is stopped at the limit, refuses as a read that decided nothing, says git was stopped, and releases publish.lock. The installer's bytes read from git are unchanged.

## Change
- `Invoke-NodeBounded` is now `Invoke-ChildBounded` (PigeonPete's note: it runs git too), with `-Raw` (stdout's exact bytes) and `-HoldStderr` (stderr handed back for a refusal to quote).
- `Get-SetupAtCommit`, `Get-GitLine` and `Get-SetupHeadCommit` run through it. `Get-GitLine` moves to the top level, and `Get-SetupHeadCommit` uses it, so there is one copy.
- The limit is the existing `-NodeTimeoutSec`, default 300, whose help now says it covers git reads.

## Decided
- Kept the parameter's name: it is what an operator types and RELEASING.md names. Rejected a second limit for git: one knob, and a read of one file has no reason to need a different one.
- A stopped git refuses through the callers' existing refusals ("git cannot say which commit..."), with a line naming the stop just above. Rejected new refusal wording at each site: each already means "cannot check, nothing written".
- Weakest premise: nothing has seen git hang, and #7951's evidence does not prove stdin was its cause. This is the same hazard closed, not a measured failure fixed.
- Changed behaviour to check: a `.cmd` git shim now starts through .NET rather than `&`. `Get-SetupAtCommit` already started git that way, so a machine with such a shim was already refused there.

## Review 1 (blind, opus)
No blocker or major. Fixed: a stopped or failed raw read returned its partial bytes (safe only through the caller's check, now none are returned); refusals gave a fetch as the fix for a hang; no end-to-end test of the installer read hanging; a comment on Get-GitLine.
Stated limit, not changed: Kill() stops the direct child, so a wrapper git.exe on Windows may leave the real git running (reasoned, not measured). The refusal and the lock are right either way; at worst a read-only git lingers. Not run end to end: the promote arm with a zip naming its commit (line "the staged zip was built from"); it shares the stage arm's read and differs in words.

## Tests
`tools/test-publish-r2-3725.sh`: a fake git that sleeps 60 s during a real promote: refused, nothing written, says it was stopped, 6 s, lock released, and a control that the lock had been taken. `tools.win-publish-node-bounded-7951.test.js` (under both PowerShells on CI): raw bytes exact (NUL, CRLF, non-UTF-8), decoded as the control; held stderr; a raw read that never ends.
