# sup-refresh-flake-3607: the supervisor-refresh test waits for the board to exit before cleanup

Card: kosmos#3607.

## Cause
`boot()` in server.supervisor-refresh.test.js resolved as soon as it called `child.kill()`,
before the board process had died. Each caller then deletes its sandbox with
`fs.rmSync(sb, { recursive: true, force: true })` while the board's boot-time writes into
`sb/data` can still be running. Under a loaded machine a write lands mid-delete and rmSync
throws ENOTEMPTY.

## Change
A shared helper, `test-support/board-child.js`:
- `stopBoard(child, { signal })` signals the child (SIGTERM by default), sends SIGKILL after
  GRACE_MS (5s), and resolves once the child has EXITED, returning `dead` from its own exit or
  signal code. It waits on 'exit', not 'close', because a grandchild that inherited the stdio
  pipes holds 'close' open after the board is gone. It returns at once for a child already
  dead, and gives up after GIVE_UP_MS (10s), logging a line, so a child that never reports
  back cannot hang the suite (tools/run-tests.sh sets no per-test timeout). An 'error' (a
  failed signal) does not end the wait.
- `runUntilBanner(child, { settleMs })` collects output until the banner, then stops the
  board. A board that dies first ends the wait on its 'close' (so its output is complete)
  instead of sitting out the 8s banner timeout.

Callers, each asserting `dead`:
server.supervisor-refresh.test.js, server.reports-refresh-1676.test.js,
server.connections-refresh-1649.test.js (inside `boot()`), server.you-verdicts-1684.test.js
and server.startup.test.js (after the `finally`; startup keeps its SIGKILL via `signal`).
The three banner files and you-verdicts assert before the delete, so a live board keeps its
sandbox. Startup deletes inside its `finally` and asserts after it, so it reports a live board
rather than preventing the delete; moving the assertion into the `finally` would mask an
earlier failure in that test.
Not changed: server.world-boot-sandbox-2628.test.js already waits on 'exit' before its
`test.after` cleanup; engine/win32apply.test.js polls the pid; tools.win-launcher-native kills
bare socket listeners that write nothing into the sandbox.

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

Committed helper test, test-support.board-child.test.js (root, so run-tests.sh globs it,
#1934): already-dead, SIGTERM honoured, SIGTERM ignored then SIGKILLed, give-up on a child that
never exits, a grandchild holding the pipes, and death before the banner. Four perturbations
of the helper (no SIGKILL escalation; no give-up; 'close' instead of 'exit'; no early return on
death) each fail exactly their own test by name; unperturbed control 6/6.

## Weakest premise
That ENOTEMPTY came from the live board rather than something else writing into the sandbox.
The `dead` assertion proves the tests now wait; it does not by itself prove that was the
only writer.
