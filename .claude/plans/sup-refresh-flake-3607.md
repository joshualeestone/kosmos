# sup-refresh-flake-3607: the supervisor-refresh test waits for the board to exit before cleanup

Card: kosmos#3607.

## Cause
`boot()` in server.supervisor-refresh.test.js resolved as soon as it called `child.kill()`,
before the board process had died. Each caller then deletes its sandbox with
`fs.rmSync(sb, { recursive: true, force: true })` while the board's boot-time writes into
`sb/data` can still be running. Under a loaded machine a write lands mid-delete and rmSync
throws ENOTEMPTY.

## Change
A shared helper, `test-support/board-child.js`: `stopBoard(child)` sends SIGTERM, sends
SIGKILL after 5s, and resolves once the child has closed (or errored), returning `dead` from
the child's own exit or signal code. It returns at once for a child already dead, and gives
up after 10s so a child that never reports back cannot hang the suite (node --test has no
per-test timeout). `runUntilBanner(child, { settleMs })` collects output until the banner,
then stops the board through `stopBoard`.

The same kill-then-delete shape was in four files, so all four use the helper:
server.supervisor-refresh.test.js, server.reports-refresh-1676.test.js,
server.connections-refresh-1649.test.js (each `boot()` asserts `dead` before returning), and
server.you-verdicts-1684.test.js (awaits `stopBoard` in its `finally`, before the rmSync).
Not changed: engine/win32apply.test.js already waits on the pid; tools.win-launcher-native
kills bare socket listeners that write nothing into the sandbox.

Rejected: `maxRetries` on rmSync. It hides the race instead of removing it.

## Evidence
Full `tools/run-tests.sh` on origin/main 1f9fa677 + an unrelated web/ change, Mac load 2 to 13:
2 of 2 runs failed both boot tests in this file with ENOTEMPTY; the file alone passed 3 of 3.
With the first version of this change, one full run: this file green.
Perturbation: with `stopBoard` resolving straight after the kill, all 8 boot tests across
the three banner files fail on the `dead` assertion, on a quiet machine, so a regression is
caught every run rather than only under load. Helper edge paths, run directly: an
already-exited child resolves dead in 1ms; a child ignoring SIGTERM is SIGKILLed and
resolves dead at the grace period.

## Weakest premise
That ENOTEMPTY came from the live board rather than something else writing into the sandbox.
The `dead` assertion proves the tests now wait; it does not by itself prove that was the
only writer.
