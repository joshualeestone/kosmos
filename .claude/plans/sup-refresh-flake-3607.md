# sup-refresh-flake-3607: the supervisor-refresh test waits for the board to exit before cleanup

Card: kosmos#3607.

## Cause
`boot()` in server.supervisor-refresh.test.js resolved as soon as it called `child.kill()`,
before the board process had died. Each caller then deletes its sandbox with
`fs.rmSync(sb, { recursive: true, force: true })` while the board's boot-time writes into
`sb/data` can still be running. Under a loaded machine a write lands mid-delete and rmSync
throws ENOTEMPTY.

## Change
`boot()` resolves on the child's `close` (dead, and its output drained) or `error`, not on
the kill. `done` is idempotent, a SIGKILL follows 5s after the SIGTERM, and a 10s give-up
resolves anyway so a child that never reports back cannot hang the suite (node --test has
no per-test timeout). It returns `dead`, and each boot test asserts it before deleting.

Rejected: `maxRetries` on rmSync. It hides the race instead of removing it.

## Evidence
Full `tools/run-tests.sh` on origin/main 1f9fa677 + an unrelated web/ change, Mac load 2 to 13:
2 of 2 runs failed both boot tests in this file with ENOTEMPTY; the file alone passed 3 of 3.
With the first version of this change, one full run: this file green.
Perturbation: the same file with boot() resolving straight after the kill fails all three
boot tests on the `dead` assertion, on a quiet machine, so a regression is caught every run
rather than only under load.

## Weakest premise
That ENOTEMPTY came from the live board rather than something else writing into the sandbox.
The `dead` assertion proves the tests now wait; it does not by itself prove that was the
only writer.
