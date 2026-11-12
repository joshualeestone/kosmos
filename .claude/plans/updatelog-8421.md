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
- Review 1: Mac and Linux only (the Windows half is specified on the card for Homer: win32's launch is asynchronous and
  can still refuse, nothing reports its end, and it keeps no install.log). The record is written only under an
  ABSOLUTE root (a test's C:\\ root once landed the record in the cwd). A spawn that fails (error, no exit) gets the
  same "did not finish" line. Versions compare as newer() does (0.8.3 is 0.8.03).
- Review 3: a board that restarts while the installer is still running (the #1728 marker holds the attempt's stamp
  and no install.status has it) says the update is still installing and KEEPS the record for the board the installer
  starts. A board newer than the target says so instead of "did not finish".
- setAutoLog is a test seam, excused in engine.reachable.test.js beside setInstallRunner and setAutoPref.

## Tests
engine/update-autolog-8421.test.js (11): the real look launches the automatic install and the line plus the record
appear; a boot on the target version says it started again, once (a second boot says nothing); after a real start, a
boot on the old version says it did not finish (both lines in the log); an installer ending while the board is up
says so and leaves no record; controls: a person's install and a paused update log nothing; a spawn error; a relative root writes no record;
the version compare; win32 writes nothing; still installing keeps the record; newer than the target. 12
mutation arms red (no
before line; no alive line; always "did not finish"; record kept; a person's install logged). Related sweep: 30 files
that name engine/update, 770 of 795 pass and 0 fail after the seam excuse.

## Not covered, stated
- The "started again" arm uses a hand-written record whose target is the running version: a real update cannot be
  made to install the version already running.
- Windows writes nothing yet (above). Found, not this change's: the #1728 in-flight marker (install.started) is written
  under a relative root by every install, a person's included (filed separately).
