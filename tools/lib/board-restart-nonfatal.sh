#!/bin/bash
# board_restart_or_warn: run release.sh's step-10 local-board restart NON-FATALLY
# (kosmos#2087).
#
# release.sh step 10 restarts the developer's OWN board on this Mac so it stops
# serving the previous code (#360). By the time step 10 runs, the publish has
# ALREADY succeeded and step 9 has verified the served bytes from inside AND
# outside the network. So a slow or stuck local board on the release machine is
# NOT part of "did we ship correct bytes", and must not turn a good publish into
# `outcome=failed` or trip downstream rollback/alerting.
#
# It was doing exactly that: Baron Draxum's 0.6.27 cut published successfully and
# then exited 1 at step 10 ("THE LOCAL BOARD DID NOT COME BACK WITHIN 45s") on a
# loaded box, while the board recovered on its own moments later and the artifact
# users pull was already live and verified. The record then read
# `outcome=failed step=_10._the_board_on_THIS_Mac served=1` -- a misleading red on
# a successful production publish.
#
# So: run the restart, and if it fails, WARN loudly (the dev should check their own
# board) but return 0, so the cut's outcome reflects the publish and step 11 (the
# installed-CLI refresh, a real #1758 fix) still runs. A genuinely-stuck board is a
# THIS-Mac problem surfaced by the warning, never a bad cut.
#
# NON-FATAL IS SCOPED HERE, not in restart-local-board.sh, whose exit code its own
# test and any other caller still rely on. This wrapper is the one place that
# decides a post-publish local restart should not fail the cut.
board_restart_or_warn() {
  local script="$1" rc=0
  # `|| rc=$?` disarms the caller's set -e for exactly this command, so a failed
  # restart records its code instead of aborting the cut.
  bash "$script" || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "WARNING (step 10, non-fatal, kosmos#2087): the local board on THIS Mac did not" >&2
    echo "  restart cleanly (the restart step exited ${rc}). THE PUBLISH ALREADY SUCCEEDED" >&2
    echo "  and step 9 verified the served bytes inside and outside the network -- this" >&2
    echo "  restart is a THIS-Mac convenience, not part of the release. A loaded box often" >&2
    echo "  recovers on its own; check the local board only if it stays on the old version." >&2
  fi
  return 0
}
