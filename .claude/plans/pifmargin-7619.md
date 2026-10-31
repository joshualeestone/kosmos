# pifmargin-7619: the prove-it-fails restore test, sound under load and safe on a shared Mac (kosmos#7619)

## Why
`tools.prove-it-fails-restore-7619.test.js` proves `tools/prove-it-fails.sh`, killed mid-run, restores the tree and ends
the test it started. On 10-30 its arms flaked under load (a 10 s death bound) and, on 10-31, a no-kill mutant of the tool
let the forker fixture fork about 3,300 sleeps, which hit this Mac's per-user process limit.

## What changed (one file, the test)
- Every wait that load slows shares a 60 s bound (start, end, death), raced so a missed kill fails at the bound.
- The forker fixture is capped at 50 and its pid list lives outside the sandbox, so cleanup can read it.
- A failed arm ends the tool's whole tree (snapshotted as the signal lands), and only pids still of the kinds the arms
  start; a passing arm, having confirmed every pid gone, runs no pid-list cleanup.
- Arms wait on 'close', so the tool's last line is in before it is matched; the runner is checked gone too; the forker
  arm checks the forker and reads the list again.

## Not done (stated)
- The card's last done-when waits on a real tmux server death; the exit watcher has run since 10-30 11:18. Staging one by
  killing the fleet's tmux server was rejected.

## Proof
Run: `node --test tools.prove-it-fails-restore-7619.test.js` (9/9, about 11 s). Mutant: the tool's kill replaced by a bare
CONT turns 7 arms red and leaves 0 sleep or test processes.
