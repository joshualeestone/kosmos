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

## Review round 3 (opus)
- WARNING: the shell rule read the real uname, so the CLI tests meant different things on a Linux host (the board and
  mode tests, and my Mac controls, would fail on the Linux CI). Fixed: `${KOSMOS_PLATFORM:-$(uname -s)}`, the file's
  own convention; the test helper names Darwin unless a test says Linux.
- WARNING: Settings on Linux still offered "Update Kosmos automatically", which never acts there. Fixed: the row and
  its status line carry data-linux-hide. web.win32-board-copy.test.js said the opposite ("auto-install runs" on
  Linux), which was never true (beginInstall refused); its list and comment are corrected.
- WARNING: "Command copied." outlived the command, and the empty status took room on every platform. Fixed: cleared
  on every paint the command does not show, and `:empty { display: none }`.
- WARNING: the Copy handler had no behaviour test. Added: copied (exec and clipboard), refused (field selected, the
  line says "command"), and a command replaced mid-copy writes nothing.
- NITs fixed: a control that the stand-in board is detected; the refusal line names the command; "in a terminal on
  this computer". Not taken: a KOSMOS_HOME exported in the person's shell (pre-existing, and the command names the
  script by this install's path).

## Review round 4 (sonnet)
- WARNING: the round-3 clear ran on every paint, so the five-second poll wiped "Command copied." (and the how-to-copy
  hint) while the same command still showed, and its comment said otherwise. Fixed: the result is kept while the
  same command shows and cleared otherwise; a repaint test pins both, and both mutants (always clear, never clear)
  are red.
- NITs: the unmeasured premise is now named beside the arm in the code, not only in this plan. Not taken: a test
  pinning SELF_INSTALL to the shell's Linux rule (Linux is the only platform off SELF_INSTALL that Kosmos supports).

## Review round 5 (opus)
- WARNING: over Kosmos+ the row told a phone to run a command "on this computer" and showed the box's home path.
  Fixed: the row and its copy line are data-remote-hide, and the remote line says to run it from Settings, Updates
  on the Kosmos computer (offlineRemoteView, as the restart toast); a test pins both views.
- WARNING: with no install offer a Linux board shows no update toast. Not built here: Windows' manual offer has the
  same gap, so it is one follow-up for both, kosmos#7938. (What this change removed was a toast whose button only
  led to a refusal.)
- WARNING: `:empty { display: none }` on a live region can stop it being announced. Fixed: `:empty { margin: 0 }`,
  so it stays rendered; the test refuses display:none there.
- NITs fixed: the Copy button is named "Copy the update command"; the command arm is gated on Linux by name (a
  freebsd board gets nothing; that mutant is red). Kept: the hidden button's data-act (as the Windows arm).

## Review round 6 (sonnet)
- WARNING: the person's terminal could be a pane inside Kosmos, which the installer's restart closes mid-run. Fixed
  in the copy: "in a terminal on this computer, outside Kosmos".
- WARNING (kept, stated): with fleet updates paused, `--install` prints `paused <v>` and installs nothing (#6781 says
  --install does not pass a pause), while the card says the version is ready. The terminal says why.
- WARNING (kept, stated): the shell's Linux rule and the engine's SELF_INSTALL are kept in step by hand; the engine
  arm is Linux by name, so a third platform off SELF_INSTALL gets no command rather than one its CLI refuses.
- NIT fixed: the new CSS rules no longer split the .upd-manual-steps pair.

## Review round 7 (opus)
- WARNING (kept, stated): the verb over a live Linux board is unmeasured; the card stays open until the #7933 leg
  runs it (PigeonPete agreed 06:43).
- NITs fixed: updateCommand is Linux by name and honours the platform it is given, so the refusal never names a
  command on a platform whose CLI refuses it; focus is not moved into the remote-hidden field; the comment says the
  command (with its home path) is still in the status payload; the repaint test uses the real after-update paint;
  the plan's test text matches KOSMOS_PLATFORM.

## Tests
- cli.update-ifnewer-4382.test.js (two new tests): with KOSMOS_PLATFORM=Linux, a board running or stopped and mode
  `run`, the verb installs with the board's three variables on prod and on a staging stamp; CONTROLS: the stand-in
  board is detected, and KOSMOS_PLATFORM=Darwin (every other call's default) refuses; an agent and an install under
  way are still refused.
- engine/update.linux-manual-7935.test.js: no install offer, the command over this home on prod and staging, a quoted
  home, the refusal carries the command, the Mac control, a source checkout offered nothing.
- web.linux-update-7935.test.js: the real paintUpdateCard on the engine's real offer; focus; a repaint clears the row;
  the markup.
- Mutants red throughout (shell, engine, board). web, cli, install and engine update tests: 5207 pass, 0 fail, on
  macOS; the CLI tests name their platform, so they mean the same on a Linux host.

## Weakest premise
UNMEASURED: that `kosmos update` running the real installer over a live Linux board leaves it serving the new version
with the person's agents and settings kept. Read from setup.sh (stop marker, kosmos stop, the put-back restart), and
the #7933 leg re-runs the installer over an install and passes, but nobody has run this verb over a live Linux board.
