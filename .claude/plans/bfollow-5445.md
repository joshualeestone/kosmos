# #5445: Linux port B follow-ups (open review findings after #4984)

Branch bfollow-5445, built on B's head 6a819cbde (PR #4984, waiting on its Mac CI). Rebase onto main once B merges.
Handed over by Splinter 02:58 2026-10-07; Kitty told. Piece D's items (install/kosmos tmux pick, systemd 240+ check,
linger notice at install, live start/stop workflow) stay with #4920, as the card says.

## Finished looks like
On Linux, a Kosmos agent the board created is listed on the board whether or not it is running (as on the Mac); the
board can tell which agents systemd has switched off and which are running; a unit the person masked reads as masked,
in a sentence that says how to undo it, not as a broken unit; a test that forgot its runner seam fails loudly; the
wording items are true on Linux. Every change has a test that fails without it, run on this Mac (the Linux code is
reached through the platform and runner seams), and the Linux lane (linux.yml) stays where it was.

## Built here
1. Display parity (card: "three listings read only .plist files"; disabledJobsResult/runningJobs launchctl-only).
   - `linuxjob.listUnits()`: the unit folder's `kosmos-agent-*.service` files as `{ name, worldId, file }` (the launch
     key read back from the escaped unit name, kept only when unitName gives the same file back). createdroster.js and
     register.js's stray sweep each read it on Linux (their Mac arms are unchanged).
   - `disabledJobsResult` / `runningJobs`: a Linux arm through linuxRun: `systemctl --user list-unit-files` (disabled
     or masked = switched off) and `systemctl --user list-units --state=active` (running). Same shapes as the Mac.
2. Masked units: `readJobVerdict` and `linuxjob.masked()` see a unit file that is a link to /dev/null and say it is
   masked, with the unmask command, not "its ExecStart line is incomplete". The agent stays on the created roster.
   NOT measured on a real systemd: a mask over Kosmos's own file is expected to be refused or to land as a runtime
   mask under /run, which leaves the file ordinary; that case reads as switched off through disabledJobsResult
   (masked-runtime). The link case is a hand-made mask or one made after the file was deleted.
3. `linuxRun` passes the live-execution gate's refusal through as a throw (live-execution now tags it with a code),
   so a test that forgot its seam fails loudly instead of reading as an ordinary { ok:false }. The two fleet polls
   (disabledJobsResult, runningJobs) still fail soft on it, as their Mac arms do (review 4): a board poll that throws
   would take the page down for a forgotten seam, where could-not-look is the honest answer.
4. Wording:
   - The "already loaded" sentence on Linux says when linger is off (it then starts only while the person is logged in).
   - `SELF_STARTS` becomes the default of `selfStarts(platform, lingering)`; on Linux with linger off it says it starts
     while you are logged in. remove.js and terminal.js use it.
   - `After=network.target` removed from both user units (it orders nothing in a user manager).
   - `escapeUnitValue` (a refusing alias) removed; callers use `unitSafe` with what they are writing.
   - delete-leftover's Trash on Linux is `$XDG_DATA_HOME/Trash/files` (default `~/.local/share/Trash/files`),
     where a Linux desktop shows it; the Mac keeps `~/.Trash`. AGENT_WORKFORCE_TRASH still wins.

## Decided, not built (each with why)
- tmux session outliving a rollback or delete: remove.js already ends the session on every platform (jobOps.end), so a
  delete does not leave it. A create rollback does not end it on the Mac either (launchctl bootout ends the
  supervisor, not the tmux server). Same behaviour on both; to measure on the Linux lane before changing either.
- Dangling default.target.wants link after a hand-deleted unit: systemd ignores it; reporting it adds a sentence for a
  state nothing acts on.
- Linger's /var/lib/systemd/linger fallback untested: gated off in tests on purpose; the live lane runs with linger on.
- Clean board-run exit (port busy) not retried under Restart=on-failure: the board's unit is installed by piece D;
  the decision belongs with its installer (kosmos start recovers today).
- Live workflow's hand-kept path filter: a CI-structure question, not B's code; stays as stated in linux.yml.
- ensureRuntimeDir sets XDG_RUNTIME_DIR for the rest of the process: deliberate (every Linux runner inherits it); a
  test leak only on a Linux runner where the value is the real one anyway.
- start()/startOnly() make the agent folder on a dry-run board: the folder is the agent's own (a dry-run board keeps
  its data in its sandbox), so nothing outside the sandbox is touched.

## Linux lane
The disabled/running probes now pick their platform; tests written for launchd that pass none would take the systemd
arm on the Linux runner. Direct callers in tests (create.test.js, world-guard-lift-1704) pass 'darwin';
machine.agentAutostartCheck passes the platform it was asked about; board tests on a launchctl fake
(server.world-offline-rows-1704, server.world-switch-agents-1704, server.offline-nextmove, server.socket-split) pin
'darwin' with create.setProbePlatformForTests (found by a sweep for every test faking launchctl list/print-disabled).
The pin only keeps their two fleet probes off systemctl; it does not make those files pass on Linux (their roster,
survey and jobMissing still follow the host, and they fail the same tests on B's head, measured with the platform
forced to linux). Making them run on Linux is #5432's work.
The lane run of this branch is compared, file by file, with the lane run of B's head (6a819cbde).
- Review 3: worldstarts passes its platform to the disabled probe; createdroster.test.js's harness pins 'darwin'. The
  class is now MEASURED, not swept: every engine test file that loads a changed module is run with process.platform
  forced to 'linux', on B's head and on this branch, and the failing tests compared; the Linux lane run of each head is
  compared by failing file (B's head: 446 failing tests in 63 files on 2026-10-07).
- create.switchedOffSentence words the offline row's switched-off cause (tested per platform); a masked unit is read
  from the disk, so it is said even when systemctl could not be asked. agyrefresh's board-start hook refresh now sees
  running Linux agents (runningJobs was always empty there); it only rewrites hooks for agents it finds running.
- An unreadable linger record keeps the default self-starts sentence: unknown is not evidence for the weaker claim.
- The board's offline row on Linux: switched off says systemd (not System Settings), a masked agent says masked with
  the unmask command, and the self-starts clause uses selfStartsSentence. lingerFileOn reads only a proven absence as
  off (an unreadable record is unknown) and never reads the host's record in a test process.
- The masked sentence quotes the unit name (a named Kosmos's \x2b escape survives a paste) and says the agent is set up
  again after unmasking (unmasking removes the link and leaves no unit).

## Weakest premise
That the escaped unit name round-trips for every launch key Kosmos makes (named worlds carry "+", written as \x2b).
listUnits reads names back with the same decoder worldFromUnitName uses, and the test covers a named-world unit.

## Tests
- engine/linuxjob.test.js: listUnits (default and named world, the board's unit, a foreign unit, a name that does not
  round-trip, could-not-look), masked().
- createdroster / register on platform linux with a unit folder fixture; control: the same with a .plist on darwin.
- create disabledJobsResult/runningJobs Linux arm through setRunner (fake systemctl), with a could-not-look case.
- linuxRun rethrows the tagged refusal; an ordinary failure still returns ok:false (control).
- selfStarts wording, the already-loaded linger sentence, unit text without After=network.target, Linux Trash path.
