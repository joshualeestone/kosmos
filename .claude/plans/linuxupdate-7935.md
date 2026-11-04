# linuxupdate-7935: a Linux board is told the installer command, not offered an [Update] it cannot take (kosmos#7935)

Found by PigeonPete's #7933 Linux promote leg (11-04 06:05): on Linux /api/update/check answered an offer and
/api/update then refused 409, "its installer is a POSIX shell script", with no next step.

## The call
Show the command (the card's own ask), not hide the update: a person must learn a newer version exists, and re-running
the served installer is what the #7933 leg does successfully.

## Change
- engine/update.js: `installOffer()` returns null off SELF_INSTALL (no [Update]); `manualOffer()` gives an installed
  board there `{ version, command }`, `command = '<home>/bin/kosmos' update --if-newer --install` (this install's own
  verb, the home quoted with any quote escaped); a source checkout gets nothing. `selfInstallRefusal()` names the same
  command when there is an install, and only says it cannot update itself otherwise.
- install/kosmos `cmd_update`: on Linux (uname) the two guards that leave an update to the board (mode not connect, a
  running board) do not apply, because the board there never installs. The agent refusal and the install-under-way
  guard still hold. The verb works out the pointer, the subscription and the base as beginInstall does, and runs the
  installer only after checking it against its signed manifest (#6468).
- web/index.html: a manual arm for `manual.command`: "Version X is ready. To update, run this in a terminal:", the
  command in a read-only field described by the status line, a Copy button with its own status line, the Check
  button stood down and focus moved to the field if it rested on Check; the row is hidden on every other paint.

## Review round 1 (opus)
- BLOCKER: the first command (`curl -fsSL '<setup url>' | sh`) passed no channel, so the served installer fell back to
  the prod pointer: a staging board would install prod's build and lose its staging subscription. Fixed by changing
  the command to this install's `kosmos update`, which carries pointer, subscription and base; a CLI test pins both
  the prod and the staging stamp.
- WARNINGs fixed with it: the command ignored a non-default home (now this install's own); it reintroduced curl | sh
  (now the verified run-setup); focus fell to <body> when Check hid (now moved to the field); a screen reader never
  heard the command (now a field described by the status line, with Copy).
- NITs fixed: a source checkout's refusal no longer offers a command; a quote in the home is escaped. Not taken:
  making Linux SELF_INSTALL (the board's restart under the Linux supervisor is not measured; this arm stays the
  path until it is).

## Review round 2 (sonnet)
- WARNING: nothing measures that the real installer, run by the verb over a live Linux board, leaves it serving the
  new version. Stated as unmeasured (below); asked PigeonPete to run the verb in his #7933 Linux leg after merge.
- WARNING: no arm for a stopped board on Linux (mode run). Added: the verb installs; CONTROL: the Mac is refused.
- WARNING: the card did not say the board restarts. Added "(Kosmos restarts when it is done)". Not added: "your agents
  keep running", true on the Mac but not measured on Linux.
- WARNING: auto-install on Linux still reached beginInstall and recorded a refusal on every look. Fixed at the source:
  autoInstallWouldStart() is false off SELF_INSTALL (no pause ask, no attempt); tested through refresh(), mutant red.
- NIT fixed: the uname rule says to keep in step with SELF_INSTALL. Kept: the hidden button's data-act (as the
  Windows arm); a stale "Command copied." after a same-command repaint (harmless).

## Tests
- cli.update-ifnewer-4382.test.js (new test): with a fake `uname` saying Linux, a board running and mode `run`, the
  verb installs with the board's three variables on prod and on a staging stamp; CONTROL: the real uname refuses; an
  agent and an install under way are still refused.
- engine/update.linux-manual-7935.test.js: no install offer, the command over this home on prod and staging, a quoted
  home, the refusal carries the command, the Mac control, a source checkout offered nothing.
- web.linux-update-7935.test.js: the real paintUpdateCard on the engine's real offer; focus; a repaint clears the row;
  the markup.
- Seven mutants red (shell, engine, board). web, cli, install and engine update tests: 5202 pass, 0 fail.

## Weakest premise
UNMEASURED: that `kosmos update` running the real installer over a live Linux board leaves it serving the new version
with the person's agents and settings kept. Read from setup.sh (stop marker, kosmos stop, the put-back restart), and
the #7933 leg re-runs the installer over an install and passes, but nobody has run this verb over a live Linux board.
