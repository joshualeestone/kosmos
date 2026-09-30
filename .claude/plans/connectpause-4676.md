# connectpause-4676: a connect computer updates past another install's board (#4676)

Plan as posted on the card (issuecomment-5902534080) and reviewed by Scorpion (issuecomment-5902568402).

Done means: on a connect-mode computer (#4356), with another install's board on the port, the update passes the pause
without telling the person to kill it; our own board still stops the update; a mid-update switch to run never starts,
restarts or reclaims on that port; a light test runs each path.

Weakest premise (measured): "this install starts no board on the port later in this run" is not always true, because
the installer re-reads the mode at every board decision (#4356). A mid-update switch to run would reach `kosmos start
--force` under KOSMOS_RECLAIM_BUSY=1, whose #3079 reclaim kills a same-uid Kosmos listener. So the fix closes that too.

1. The carve-out records `_kosmos_pause_left_foreign=yes`. The gone-by-port wait then counts only a listener whose
   command is THIS install's `$KOSMOS_HOME/app/server.js` (Scorpion: our own board behind a stale board.pid must still
   stop the update).
2. `_kosmos_board_decide` keeps the board off for the rest of the run once the flag is set; `_kosmos_off_for_foreign`
   (flag AND run|both) picks a third wording: quit that one, then run 'kosmos start', or KOSMOS_PORT (Scorpion: skip
   and say why). An unreadable choice keeps its own words. Our own board up at the last reading on a run computer is
   treated as running.
3. Tests: install.connect-pause-4676.test.js runs the SHIPPED blocks under sh with set -euo pipefail.

Named, not fixed here: the NEXT start meets the #3079 reclaim (#4679, Scorpion).
