# #4818: a failed update starts again the board it paused

Card: joshualeestone/kosmos#4818 (priority, claimed:angel). Branch updaterestart-4818 off main.

## What finished looks like
An update (by hand or automatic) that fails after pausing a board that was running ends with that board running
again on the install that is on disk, no board.stopped, and a line saying which version is back. A board the person
had stopped stays stopped.

## The change (install/setup.sh)
- A `BEGIN/END #4818 put-back` block before the update pause: `_kosmos_put_board_back` (remove board.stopped, `kosmos
  start --force`, check the port answers, say "Kosmos is running again on <version>" or how to start it) and an EXIT
  trap that calls it when the run exits non-zero (a die, or set -e).
- At the pause: `_kosmos_was_running=yes` only if the mode runs the board here, there is no board.stopped, and the board
  answers on its port BEFORE the stop.
- After the pause holds (the existing #2055 "got past the pause" point): `_kosmos_paused_board="$_kosmos_was_running"`.
- After the new board starts (the existing `kosmos start --force || die`): `_kosmos_paused_board=no`.

## Decisions
1. An EXIT trap rather than only `die()`: setup runs `set -euo pipefail`, so an unplanned command failure exits without
   die. Rejected: hooking die only.
2. Armed only once the pause held, so the "board would not pause" abort (the board still running) never restarts.
3. Start whatever install is on disk. A version-mismatch failure fires after the swap (the landed tree is complete, in
   Josh's case 0.7.11); an earlier failure leaves the old tree. If starting fails, the line says how to start Kosmos.
4. board.stopped present before the run is the person's choice and is kept, even if something was answering.
WEAKEST PREMISE: that the tree on disk after a failure can start. A failure mid-swap could leave a tree that cannot;
then the run says so and how to start Kosmos, which is no worse than today. Also: removing board.stopped lets launchd's
KeepAlive start the board at the same time as `kosmos start --force`; the same pair happens on every normal update
(setup removes the marker and starts the board), so this relies on `kosmos start` handling a board already starting.

## Tests (tools/test-update-putback-4818.sh, wired into test:shell; runs the shipped bytes)
A fake kosmos on a real port: a failed update puts the board back (answers, no board.stopped, "running again on
0.7.11"); controls: a board stopped before the run stays stopped, and a board answering but marked stopped stays
stopped; a failure after the new board started, and a successful run, restart nothing. Mutants, each failing a test:
trap neutered, any exit restarts, the marker ignored, the marker kept. The installer shell tests near the pause
(#2055, #964, install-static and its control, runnable guard, progress emit, resolve user, zsh tied names) and the
wiring tests (every-test-runs, shell shard, install reachable, local board) pass.
