# #4818: a failed update starts again the board it paused

Card: joshualeestone/kosmos#4818 (priority, claimed:angel). Branch updaterestart-4818 off main.

## What finished looks like
An update (by hand or automatic) that fails after pausing a board that was running ends with that board running
again on the install that is on disk, no board.stopped, and a line saying which version is back. A board the person
had stopped stays stopped.

## The change (install/setup.sh)
- A `BEGIN/END #4818 put-back` block before the update pause: `_kosmos_put_board_back` (read the mode again and start
  nothing if it now keeps the board off; remove board.stopped; `KOSMOS_RECLAIM_BUSY=1 kosmos start --force`; check the
  port answers; say "Kosmos is running again (<version on disk>)" or how to start it) and an EXIT trap that calls it
  when the run exits non-zero (a die, or set -e), plus `trap 'exit 1' HUP TERM` so a closed window or a TERM is a
  failure too (review 2: both ran the EXIT trap with status 0).
- At the pause: `_kosmos_was_running=yes` only if the mode runs the board here, there is no board.stopped, and the board
  answers on its port BEFORE the stop.
- Armed (`_kosmos_paused_board="$_kosmos_was_running"`) once the board stops answering, AFTER the three pause dies that
  must not restart (our board still running, another install's board, another app on the port) and BEFORE the port wait
  (review 3: a survivor still holding the port, or a hang-up during that wait, used to leave the board off).
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
stopped; a failure after the new board started (the shipped line), and a successful run, restart nothing; a failure
through the shipped die() puts it back; a switch to connect during the run keeps it off. The harness takes the shipped
mode readers and calls _kosmos_board_decide where setup does. Review 2: a set -e failure with no die, and HUP and
TERM delivered to the running shell and its children, each put the board back (with guards that the arm reached the
pause and the signal really ended the run; the arms wait for the shell's child before signalling). Review 3: the
arming position is pinned by line order in the shipped file. 14/14, three runs in a row. Without the HUP/TERM trap both signal arms fail (checked). Mutants, each failing a test:
trap neutered, any exit restarts, the marker ignored, the marker kept, the mode not re-read (any edit to the
anchored lines also fails the test, by design). The installer shell tests near the pause
(#2055, #964, install-static and its control, runnable guard, progress emit, resolve user, zsh tied names) and the
wiring tests (every-test-runs, shell shard, install reachable, local board) pass.

## Review
Round 1: no blocker. 2 should-fix taken: the put-back re-reads the mode (a connect switch during the run kept its board
off only until a failure), and the test now drives the shipped started line and die(). Nits taken: the message names the
version on disk without claiming it is the old one; the start reclaims a busy port as the normal start does. Noted, not
changed: a Ctrl-C also stops the log reader, so the trap's line can be lost while the board is still started.
Round 2: no blocker. 1 should-fix taken: HUP and TERM end the run as a failure. Nits taken: a set -e test, the
comment names an unreadable mode file too. Noted: the stop line and the pause post-checks are re-typed in the harness,
not extracted (the four extractions are exact and fail loudly on drift).
Round 3: no blocker. 2 should-fix taken: armed before the port wait, not after it; the signal arms wait for the child.
Noted, not changed: a new board that "would not start" makes the put-back try one more start of the same tree (a
second wait and message after the die); `_kosmos_was_running` is one 2 s probe, so a board mid-restart under launchd
at that moment reads as not running.
