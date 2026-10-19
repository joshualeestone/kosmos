# loginjob-6310: an agent started at login by its own LaunchAgent is not "missing"

Card: #6310. Owner: Angel.

## Done means
On a Mac where agents start at login from LaunchAgents Kosmos did not write, the Agents tab does not count them as
"will not come back", and Repair writes no second job for them. An agent with no login job anywhere is still counted
and still repaired. A login job that cannot be read leaves the answer unknown (shown, never repaired).

## Steps
1. [x] `engine/register.js` `jobReader` (Mac): our plist, OR a non-Kosmos LaunchAgent (RunAtLoad or KeepAlive, not
   Disabled) whose WorkingDirectory is the worker folder or inside it, OR a starting job whose launcher (2 MB or less)
   names the whole worker folder path (see Decided for the exact rules). Plist XML read as text (no process on the 5 s poll); binary
   plists through plutil; cached by mtime and size.
2. [x] Tests in `engine/register.test.js`: the fleet shape with a no-job control; disabled, never-starting and
   other-folder jobs do not cover; unreadable plist gives null; a start-script mention covers a KeepAlive job, not a
   periodic one, and `.../leo` does not match `.../leonardo`.
3. [x] Measured on the fleet Mac (read-only survey): 0.7.51 says 18 missing; this branch, after review, says 1
   (leftover-unrelated, which genuinely has no login job).

## Decided, not missed
- Matching by folder, not by label (`com.<name>.discord`): the label is this fleet's habit; the folder is what makes a
  job start THIS agent.
- A job not Disabled that is KeepAlive or RunAtLoad covers its WorkingDirectory (and folders inside it), whatever it
  is scheduled for. Its start scripts are searched only when it is KeepAlive, or RunAtLoad with no schedule or trigger
  (StartInterval, StartCalendarInterval, WatchPaths, QueueDirectories, StartOnMount). Why the split: on 10-16 the
  fleet Mac's survey showed Vivienne with no login job when her bot had not been restored after the move, while her
  scheduled email jobs' scripts name her folder; counting those mentions would have hidden a real missing agent.
  A KeepAlive dict of conditions only may not start a job at login: accepted over-match. A scheduled job's own
  WorkingDirectory still counts, though it could hide a missing agent the way a script mention would: a WorkingDirectory
  is a job's own statement of where it runs, much stronger evidence than a word in a script, and the error it risks
  (a banner line missing) is the safe one; not counting it risks Repair starting a second copy of a running agent.
- A login job that can never be read (a corrupt binary plist, a root-only file) keeps every agent without its own plist
  unknown until it changes or goes; the board logs it once ("could not read login job ..."), and #6320 will tell the
  person. A relative WorkingDirectory is ignored.
- A job's arguments are searched only when they look like launchers: executable, or named like a script (.sh, .js,
  .py and so on). A log being followed or a data file is never read; when even its folder cannot be opened, only a
  script-like name leaves "no job" unproven. A launcher that exists but cannot be read may be
  any agent's, so every agent without its own plist is unknown. A binary (the interpreter itself) and text over 2 MB
  (a bundled CLI) are not searched and doubt nobody. The limit was 64 KB until a read-only survey of the fleet Mac
  showed real launchers of 109 KB, 110 KB and 375 KB (Kosmos's own board).
- Deferred, not missed: when agents are unknown the banner shows only proven absences, so it can go quiet (one
  unreadable launcher anywhere, a TCC-protected or root-only script, does that for every agent without its own plist). Telling the
  person "we could not check N agents" needs new copy and a field on /api/register: follow-up card #6320.
- The folder may be the WorkingDirectory (or a folder inside it), or named in the start command (ProgramArguments or Program) or in a start
  script of 2 MB or less that the command names, as written, as its real path, or under the home folder as ~ or $HOME.
- A plist that reads as text but not as a property list makes UNKNOWN only an agent whose folder it names; one that
  cannot be read at all makes every agent without its own plist unknown. Unknown is never repaired, and the banner
  counts only proven absences, so an unknown agent is not listed there (the safe direction for a button that starts
  processes).
- Over-match is accepted on purpose: a starting job whose script merely names a worker folder (a watcher, a comment)
  marks that agent covered. That hides a banner line; the opposite error installs and starts a second copy of a live
  agent, the harm this card is about.
- A plist or a launcher script that could not be read is asked again a minute later. A plist that read but is not a property list (or has no closing dict) is cached until it changes.
  A plist over 256 KB is not a job launchd loads; its first 256 KB are kept as a suspect (only an agent it names is
  unknown), cached until it changes. A launcher that could not be read is asked again a minute later. One survey converts at most 4 binary plists with plutil
  (it blocks the board for up to 2 s each when it hangs); the rest count as unreadable and are tried a minute later.
  An agent whose own folder cannot be resolved (anything but "it does not exist") is unknown, not missing.
- Only ~/Library/LaunchAgents is read (Kosmos writes its own jobs there); /Library jobs are not. A start script on a
  hung network mount would block the survey's read; not handled.
- Each agent's answer is remembered until a login job, a launcher script or the home folder changes. Measured on the
  fleet Mac (about 80 agents, 40 login jobs): a cold survey about 22 ms, a warm one about 9 ms.
- A launcher under a folder macOS guards with a privacy prompt (Documents, Desktop, Downloads, app containers, iCloud
  Drive), under either the OS home or Kosmos's, in any letter case, or on another volume, or a symlink pointing there
  (its own target is read with readlink, which does not open the folder), is never touched, not even with stat (a test
  records every file call to prove it), so the five-second poll raises no prompt; the same goes for a WorkingDirectory
  there, which then counts as not resolved; a script-like name there
  leaves every agent without its own plist unknown (#6320 is how the person will be told).
- Script text is matched ignoring case (the Mac's disks do), under the folder as written, its real path, and ~ or
  $HOME for both the OS home and Kosmos's own; the quoted forms "$HOME" and "${HOME}" read as $HOME.
- Known inconsistency, not changed here: `create.jobMissing` (the offline card's "Made before Kosmos recorded this")
  still looks only at Kosmos's own plist, so an agent covered here can still get that card's no-job wording. In #6320.
- Not covered: a PARENT folder that is a link into a guarded place (~/work linked into Documents) is not detected,
  so a path through it is stat'ed and could raise a prompt.
- Tests that need a mode-000 file skip as root. CI does not run as root (GitHub's Linux runners use an ordinary
  user; the Mac runner is kosmos-ci), so they run there; a root run would not cover the unreadable paths.
- Not covered, stated so nobody reads it as covered: a launcher that runs a SECOND script holding the folder (one hop
  only), the legacy OnDemand key, plist XML comments, a UTF-16 script (read as binary) or plist (read as not a plist), a relative script argument
  resolved against the job's WorkingDirectory, a relative `cd`, a folder built from variables other than HOME,
  a job switched off with `launchctl disable` (the override database, not the plist). A chained launcher, a relative
  `cd` and other variables read as missing (Repair would add a second job); OnDemand, comments and `launchctl disable`
  can read either way.
- Measured on the fleet Mac after these changes (read-only survey): 1 missing (leftover-unrelated, genuinely no job).
