# sup-refresh-flake-3607: the supervisor-refresh test waits for the board to exit before cleanup

Card: kosmos#3607.

## Cause
`boot()` in server.supervisor-refresh.test.js resolved as soon as it called `child.kill()`.
Each caller then deletes its sandbox with `fs.rmSync(sb, { recursive: true, force: true })`
while the board it just signalled can still be writing into `sb/data`. Under a loaded
machine the write lands mid-delete and rmSync throws ENOTEMPTY.

## Change
`boot()` resolves on the child's `exit` event, after the kill. A second call to `done`
(the 8s timer after the banner already fired, or the reverse) is a no-op, and a SIGKILL
follows 5s after the SIGTERM so a board that ignored the signal cannot hang the test.

Rejected: `maxRetries` on rmSync. It hides the race instead of removing it.

## Evidence
Full `tools/run-tests.sh` on origin/main 1f9fa677 + an unrelated web/ change, Mac load 2 to 13:
2 of 2 runs failed both tests in this file with ENOTEMPTY; the file alone passed 3 of 3.
With this change, one full run: this file green (a different, load-timed test,
engine/feedguard.test.js:246, failed that run and passes alone 2 of 2).

## Weakest premise
n is small: one full run with the fix. The cause is read from the source, not reproduced by
a controlled perturbation.
