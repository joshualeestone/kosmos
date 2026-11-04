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
That re-running the installer over a Linux install keeps the person's agents and settings, as on the Mac. The #7933
leg re-runs it and passes, but not with live agents on the board.
