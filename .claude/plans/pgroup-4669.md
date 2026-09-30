# pgroup-4669: a board started by `kosmos start` outlives the launchd job that ran it

Card: kosmos#4669 (root cause on the card, comment 5901814664).

## Problem
When a launchd job ends, launchd kills every process left in the job's process group.
`kosmos start`'s unsupervised path launches the board with `nohup ... &`, which stays in
the caller's group. So a board started from a launchd job that runs `kosmos start` dies
the moment that job exits:
- the board watchdog (bin/board-watchdog.sh, a StartInterval job), whenever the board is
  unsupervised: every box whose LOADED board job is still the pre-#2956 `kosmos start`
  definition (it updated past #2956 and has not logged in again since), like Mortals;
- an old-style login job (`kosmos start`) kickstarted by the watchdog's second attempt.

Measured on Mortals 2026-09-29: the watchdog's recovery board (pid 70825) lived 745 ms
and died with the watchdog job at 19:28:43.931. The board stayed down until a person
started it.

## Change
`install/kosmos` cmd_start: `set -m` before the nohup launch, `set +m` after, so the
board leads its own process group. `$!` is still the board's pid (env and nohup exec),
so the pidfile, `_await_board_up`, stop and the #3079 reclaim are unchanged. Nothing in
install/kosmos, install/setup.sh or bin/board-watchdog.sh reads a process group.

## Rejected
- AbandonProcessGroup=true in the watchdog plist: a plist change only takes effect at the
  next login on boxes like Mortals, and would miss the old `kosmos start` login job.
- Launching through node `spawn(..., {detached: true})` or perl setsid: more moving parts
  for the same effect.

## Tests
`cli.start-own-pgroup-4669.test.js`: the real CLI's nohup start in a sandbox home with a
stub board, run as its own process-group leader (as launchd runs a job). After it exits,
SIGKILL exactly the listed pids left in that group (never a negative pid) and assert the
board still answers. CONTROL: a copy of the CLI without `set -m` must see the board die.
Red on main's CLI (both arms), green with the fix.

Real-thing reproduction first (Agent1s, throwaway launchd jobs com.barondraxum.repro4669*):
nohup child dies at job exit; with `set -m`, or with AbandonProcessGroup, it lives.

## Weakest premise
That no launch site other than cmd_start's nohup line starts a long-lived process from a
launchd job. The review is asked to look for others.
