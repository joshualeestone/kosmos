# strandlinux-6667: Linux revives an update pause stranded by a killed update (kosmos#6667)

## Goal
On Linux, an update killed while it had the board paused leaves `board.stopped` and its own
`board.stopped.by-install.<pid>.<token>` name. systemd's `ConditionPathExists=!board.stopped` cannot read the name, so
the board stayed down until a person ran `kosmos start` (the outage #6651 fixed on macOS). Done means: on a real Linux
box, a killed update's pause clears by itself while a person's stop stays, both measured.

## Call
A small pause check beside the board's unit, written by `engine/linuxboard.js`:
- `kosmos-pause-check[.<hash>].service`: a oneshot running `kosmos board-revive`.
- `kosmos-pause-check[.<hash>].timer`: `OnCalendar=minutely`, enabled by `installBoard` after the board.
- `kosmos board-revive` (install/kosmos): marker present, board unit enabled (the Mac watchdog's gate 2), and
  `kosmos_clear_stranded_pause pause-check` succeeds (the #6651 shared rule, untouched), then
  `systemctl --user start --no-block` the board. Anything else exits 0 and changes nothing. A start systemd will not
  take (unit missing or masked, no user bus) exits 1 and is logged; a board that fails after it is started is the
  board unit's own business (Restart=on-failure), not this check's.
- Removed first by `removeBoard` and by every uninstall branch in setup.sh (`_kosmos_linux_remove_pause_check`, run
  once before the branches, skipped in a sandboxed run like the rest).

## Rejected
- (b) a timer, or a unit without the condition, that starts the BOARD itself every minute: it would also restart a
  crash-looping board or one stopped with plain `systemctl stop`, which is new supervision with no crash-loop guard
  (the Mac watchdog has one). Out of this card.
- `ExecStartPre` on the board unit alone: systemd evaluates `ConditionPathExists` before it, and nothing starts the
  unit after an update stopped it, so it would never run.
- Replacing `ConditionPathExists` with `ExecCondition`: changes how every Linux board starts and restarts, for no gain
  over a separate check.
- Naming it `kosmos-board-*`: setup.sh's app-gone uninstall branch names every other `kosmos-board*.service` as
  another install's board.
- Passing the unit name to `board-revive`: install/kosmos already derives it (`_kosmos_board_systemd_unit`, kept equal
  to `boardUnitName` by tools/test-board-supervised-linux-4918.sh).
- Extending the node step's output for a refused timer: setup.sh matches that output exactly ("loose lingering"); it
  asks systemd (`is-enabled`) instead.

## Weakest premise
That one minute is soon enough and cheap enough. A run is a bash start plus a few file tests (under 50 ms measured on
the Mac); the Mac watchdog runs on a similar cadence. Second: a downgrade to a release without `board-revive` leaves
the timer running an unknown verb, which exits 2 every minute (a failed oneshot, logged) until the next install.

## Tests
- tools/test-board-revive-6667.sh (test:shell and linux-systemd.yml): the real install/kosmos with a stub systemctl:
  a killed update's pause is cleared and the board started; a person's stop, a running update, a leftover name, a
  non-run mode and a disabled unit are left alone; no marker asks systemd nothing; a refused start exits 1 and logs;
  setup.sh's names equal linuxboard.js's for two homes. Three mutants of board-revive (no enabled gate, clear any
  stop, no start) each go red on the right arm.
- engine/linuxboard.pausecheck-6667.test.js: names, unit contents, install order, a refused timer does not fail the
  install, removeBoard removes the check before the board.
- tools/test-linux-pause-check-live-6667.sh (linux-systemd.yml, ubuntu runner, real systemd): control (systemd alone
  refuses the start), the real timer clears a killed update's pause and the board comes back, a person's stop holds
  through a firing, removeBoard removes all three units.

## Round 1 (opus): no blocker, 2 warnings, 5 nits, all addressed
- WARNING: the live control could go red by chance if the timer fired in its ~2 s window. FIXED: the timer is
  stopped while the control runs and started again before the wait, so a fresh firing does the clear.
- WARNING: `_kosmos_linux_remove_pause_check` was run by no test. FIXED: test-board-revive-6667.sh lifts it and
  checks it with systemctl (disable, stop, delete, reload), without systemctl (files and the timer's enable link
  still go), and with nothing installed (systemd not asked). A mutant keeping the enable link goes red.
- NIT: the new function sat under the #2956 comment that describes board-run. FIXED: moved above it (and a comment
  line my own edit had merged into one long line is split again).
- NIT: the --no-block comment overstated a deadlock, and "a refused start exits 1" was wider than true. FIXED: the
  comment and this plan now say exit 1 covers a start systemd will not take, not a board that fails after it.
- NIT: bare systemctl where the file uses $SYSTEMCTL. FIXED.
- NIT: the install note asked real systemd for units written to a sandbox folder. FIXED: skipped when
  AGENT_WORKFORCE_SYSTEMD_DIR is set.
- NIT: the #4918 live test's cleanup left this home's timer behind if it failed early. FIXED: it removes the pause
  check too.
- Residual, accepted: an OLDER release's uninstall (or a downgrade) does not know the pause check, so its timer stays
  and its oneshot fails every minute until the next install of this release or later. Rare (a downgrade), loud (a
  failed unit in systemctl --failed), and harmless (it starts nothing).

## Round 2 (sonnet): no blocker, 2 warnings, 5 nits
- WARNING: "a sandboxed run with AGENT_WORKFORCE_SYSTEMD_DIR reaches real systemd through the uninstall helper; linuxboard
  refuses that case". NOT CHANGED, premise false: linuxboard's runner refuses only when AGENT_WORKFORCE_LAUNCH is set
  AND AGENT_WORKFORCE_SYSTEMD_DIR is not (engine/linuxboard.js:39); with a units folder of its own it talks to real
  systemd too. The helper's gate is that same rule. The comment that said "a sandboxed run touches neither" was loose
  and now states the rule exactly.
- WARNING: the first update to this release is not protected. TRUE, and not fixable in code: the timer exists only
  once some run's installBoard has written it, so an update killed BEFORE that step on a box whose units predate this
  release still strands the board (the population #6651/#6667 describe). From the next update on it is covered.
  Recorded here and on the card, so nobody reads the card as covering that first one.
- NIT: the helper runs even in the uninstall branch that leaves a board unit in place. NOT CHANGED, though my reason
  here was WRONG (corrected in round 3): the helper removes only this home's hash-named units, so another install's
  board keeps its own pause check.
- NIT: a merged over-long comment line in linuxboard.js (my round-1 note claimed it was split; that was the one in
  install/kosmos, not this one). FIXED: rewrapped.
- NIT: install/setup.sh is not in linux-systemd.yml's paths. NOT CHANGED: the live job never runs setup.sh, so adding it
  would spend a 3 to 5 minute Linux job on every setup.sh PR without testing setup.sh; the uninstall helper is tested
  by test-board-revive-6667.sh in test:shell.
- NIT: the live person's-stop arm uses a bare marker only, not a leftover name beside a later stop. NOT CHANGED: the
  leftover case is the shared #6651 rule, covered by test-board-revive-6667.sh case 4 and #6651's own tests.
- NIT: timeout margin. NO CHANGE NEEDED: worst case about 160 s of waiting inside a 15 minute job.

## Round 3 (opus): no blocker, 2 warnings, 3 nits, all addressed
- WARNING: a timer left behind once its Kosmos folder is gone (deleted by hand, a downgrade, or the app-gone branch
  with another hash) failed every minute forever. FIXED: the check's service carries ConditionPathExists on the
  kosmos binary and on board.stopped, so both are quiet skips (and no bash starts each minute when nothing is
  paused). The app-gone uninstall branch now names a leftover kosmos-pause-check timer with another hash, as it
  names board units. Mutant (no binary condition) reds the engine test.
- WARNING: no test ran setup.sh's own install and uninstall of the pause check on real systemd. FIXED:
  test-linux-setup-4920.yml (every PR, ubuntu runner) asserts the timer is enabled and active after a real setup.sh
  install, and the timer, the service and the timer's enable link are gone after a real --uninstall.
- NIT: my round-2 comment and reason about the keep-the-board branch were wrong. FIXED: the comment says only this
  home's units go and another install's, its pause check included, are not touched.
- NIT: removeBoard left the timer's enable link when a disable was refused. FIXED: it deletes it (lstat, so a
  dangling link counts), as setup.sh's helper does. Mutant (link not deleted) reds the engine test.
- NIT: the pauseCheck return value's comment overstated its use. FIXED: it says setup.sh asks systemd instead.
