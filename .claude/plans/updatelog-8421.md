# updatelog-8421: the board log says an automatic update started, and how it ended

Card: kosmos#8421 (Angel's finding, 11-11 20:23). An automatic update (engine/update.js maybeAutoInstall) wrote nothing
to the board log, so the board stopping for it and coming back on a new version read like a crash; three agents showed
their test timings before install.log named it.

## Change
- engine/update.js maybeAutoInstall: once the installer has actually launched, one line to the board log ("Kosmos is
  updating itself to X from the Y channel (an automatic update, from Z) ... the installer's own record is in
  <install.log>"), and a record `logs/install.auto` {from, to, channel, startedAt} beside install.status.
- noteAutoUpdateAtBoot(), called once by server.js right after the "Kosmos update check" line: reads and removes the
  record and says "started again on X after its automatic update from Z", or, when this board is not X, "did not
  finish; this board is running V" and where the installer's record is.
- An automatic installer that ends while the board is still up (a refusal before it stopped the board) says so and
  removes the record, so the next boot does not report it again.
- A person's own install says nothing new (it is watched); a paused update launches nothing and says nothing.
- Best-effort: a line or a record that cannot be written never stops or fails an update.
- setAutoLog is a test seam, excused in engine.reachable.test.js beside setInstallRunner and setAutoPref.

## Tests
engine/update-autolog-8421.test.js (5): the real look launches the automatic install and the line plus the record
appear; a boot on the target version says it started again, once (a second boot says nothing); after a real start, a
boot on the old version says it did not finish (both lines in the log); an installer ending while the board is up
says so and leaves no record; controls: a person's install and a paused update log nothing. 5 mutation arms red (no
before line; no alive line; always "did not finish"; record kept; a person's install logged). Related sweep: 30 files
that name engine/update, 770 of 795 pass and 0 fail after the seam excuse.

## Not covered, stated
- The "started again" arm uses a hand-written record whose target is the running version: a real update cannot be
  made to install the version already running.
- Windows: the before line and the record are written (maybeAutoInstall is shared), and the boot line reads them, but
  win32's installer does not go through wireChild, so the alive-exit line is Mac and Linux only. A win32 refusal while
  the board is up leaves the record, and the next boot then says the update did not finish, which is still true.
