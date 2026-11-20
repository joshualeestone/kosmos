# linuxpress-8786: kosmos#8786 slice 1, the [Update] press on an installed Linux board

## Goal
An existing Kosmos Cloud box (and any installed Linux board) never gets a newer release, because a Linux board
cannot press [Update]: it is told to type `kosmos update --if-newer --install`. Nobody sits at a Cloud box's
keyboard. Slice 1 gives an installed Linux board the button, when pressing it is safe.

## Decided (card comments 7029005593, 7030472428, 7030766599, 7030775317)
- The press runs the SAME detached run-setup the Mac's press runs (engine/update.js beginInstall): the installed
  copy's own verifier checks the installer and the target's signed manifest first (never curl | sh).
- Offered only when this board process is in its own systemd unit's cgroup AND that unit's KillMode reads
  `process`, read from the system (`systemctl --user show`), not the unit file. Measured on Ubuntu 24.04 both ways:
  KillMode=process, the update finished and the board came back; control-group, the installer died mid-install
  and the computer was left with no board.
- Otherwise the card keeps #7935's command and a stray press is refused with it.
- NOT SELF_INSTALL: canSelfInstall also gates the unattended install (autoInstallWouldStart). A Linux entry there
  would install automatically on every Linux board following its own channel, and Cloud boxes are created on
  staging. The unattended path stays off on Linux; slice 2 brings a prod-only schedule.

## Out of scope
- Slice 2 (Cloud nightly, prod only).
- Any change to install/kosmos or setup.sh.

## Rejected
- Spawning `kosmos update --if-newer --install` from the board: wireChild writes install.started right after the
  spawn and cmd_update refuses on a fresh marker, so the press could refuse itself; the board's own run-setup spawn
  is the same work with the existing single-flight and install.status bookkeeping.
- Adding linux to SELF_INSTALL (above).

## Weakest premise
That the board's own spawn (env KOSMOS_UPDATE_BY_BOARD=1) behaves on Linux as the measured `kosmos update` run did.
Both run manifest-verify.js run-setup from inside the board's cgroup; the env differs. To be measured on a real box
after merge.

## Validation
Targeted: engine/update.linux-press-8786.test.js (new; mutants of the comparison, the status check, the fresh
window, the retry window and the unit shape each go red), web.linux-update-7935 (engine to page), update.linux-manual-7935,
update.test, update.win32-570, update.win32-check, engine.reachable, fixture-discipline, tools.every-test-runs,
check-frozen-roots. Full suite through the Mortals queue (one heavy run at a time on Agent1s).

## Not tested here, on purpose
- POST /api/update through server.js: the route reads only selfInstallRefusal(), which the engine tests drive both
  ways; booting the server for one arm is left to the real-box measurement after merge.
- The press end to end on a real board: the live-execution gate stops a test before /bin/sh by design.
