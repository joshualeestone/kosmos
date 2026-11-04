# linuxupdate-7935: a Linux board is told the installer command, not offered an [Update] it cannot take (kosmos#7935)

Found by PigeonPete's #7933 Linux promote leg (11-04 06:05): on Linux /api/update/check answered an offer and
/api/update then refused 409, "its installer is a POSIX shell script", with no next step.

## The call
Show the command (the card's own ask), not hide the update: a person must learn a newer version exists, and re-running
the served installer is what the #7933 leg does successfully.

## Change
- engine/update.js: `installOffer()` returns null off SELF_INSTALL (no [Update]); `manualOffer()` gives an installed
  board there `{ version, command }`, `command = curl -fsSL '<setupUrl()>' | sh` (setupUrl picks /setup or
  /setup-staging by the pointer and carries ?v=, hence the quotes); a source checkout still gets nothing.
  `selfInstallRefusal()` names the same command instead of the shell-script reason.
- web/index.html: a manual arm for `manual.command`: "Version X is ready. To update, run this in a terminal:", the
  command in `#upd-command` (selects whole on a click), the Check button stood down; the row is hidden on every
  other paint.

## Tests
- engine/update.linux-manual-7935.test.js: as linux from any OS (platform, root and network are seams): no install
  offer, the prod and staging commands, the refusal carries the command, the Mac control unchanged, a source checkout
  offered nothing.
- web.linux-update-7935.test.js: the real paintUpdateCard fed the engine's real Linux offer: the line, the command,
  no button, no download; the Mac offer keeps the row hidden; a repaint clears it; the markup and style.
- Five mutants red. web*.test.js and engine/update*.test.js: 3743 pass, 0 fail (run from the worktree root).

## Weakest premise
That re-running the installer over a Linux install keeps the person's agents and settings, as on the Mac. The #7933
leg re-runs it and passes, but not with live agents on the board.
