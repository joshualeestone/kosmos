# loginjob-6310: an agent started at login by its own LaunchAgent is not "missing"

Card: #6310. Owner: Angel.

## Done means
On a Mac where agents start at login from LaunchAgents Kosmos did not write, the Agents tab does not count them as
"will not come back", and Repair writes no second job for them. An agent with no login job anywhere is still counted
and still repaired. A login job that cannot be read leaves the answer unknown (shown, never repaired).

## Steps
1. [x] `engine/register.js` `jobReader` (Mac): our plist, OR a non-Kosmos LaunchAgent (RunAtLoad or KeepAlive, not
   Disabled, no schedule) whose WorkingDirectory is the worker folder, OR whose arguments or named start script (2 MB
   or less) contain the whole worker folder path (see Decided for the exact rule). Plist XML read as text (no process on the 5 s poll); binary
   plists through plutil; cached by mtime and size.
2. [x] Tests in `engine/register.test.js`: the fleet shape with a no-job control; disabled, never-starting and
   other-folder jobs do not cover; unreadable plist gives null; a start-script mention covers a KeepAlive job, not a
   periodic one, and `.../leo` does not match `.../leonardo`.
3. [x] Measured on the fleet Mac (read-only survey): 0.7.51 says 18 missing; this branch, after review, says 1
   (leftover-unrelated, which genuinely has no login job).

## Decided, not missed
- Matching by folder, not by label (`com.<name>.discord`): the label is this fleet's habit; the folder is what makes a
  job start THIS agent.
- A job "starts at login" when it is KeepAlive, or RunAtLoad with no schedule or trigger (StartInterval,
  StartCalendarInterval, WatchPaths, QueueDirectories, StartOnMount), and its own top-level Disabled is not true. A
  KeepAlive job counts even with a schedule, because launchd starts it at login anyway.
- A job's arguments are searched only when they look like launchers: executable, or named like a script (.sh, .js,
  .py and so on). A log being followed or a data file is never read. A launcher that exists but cannot be read may be
  any agent's, so every agent without its own plist is unknown. A binary (the interpreter itself) and text over 2 MB
  (a bundled CLI) are not searched and doubt nobody. The limit was 64 KB until a read-only survey of the fleet Mac
  showed real launchers of 109 KB, 110 KB and 375 KB (Kosmos's own board).
- Deferred, not missed: when agents are unknown the banner shows only proven absences, so it can go quiet (one
  unreadable launcher anywhere, a TCC-protected or root-only script, does that for every agent without its own plist). Telling the
  person "we could not check N agents" needs new copy and a field on /api/register; it is a follow-up, not this card.
- The folder may be the WorkingDirectory, or named in the start command (ProgramArguments or Program) or in a start
  script of 2 MB or less that the command names, as written, as its real path, or under the home folder as ~ or $HOME.
- A plist that reads as text but not as a property list makes UNKNOWN only an agent whose folder it names; one that
  cannot be read at all makes every agent without its own plist unknown. Unknown is never repaired, and the banner
  counts only proven absences, so an unknown agent is not listed there (the safe direction for a button that starts
  processes).
- Over-match is accepted on purpose: a starting job whose script merely names a worker folder (a watcher, a comment)
  marks that agent covered. That hides a banner line; the opposite error installs and starts a second copy of a live
  agent, the harm this card is about.
- A plist that could not be read is asked again a minute later; a launcher script that could not be read, on the
  next survey. A plist that read but is not a property list (or has no closing dict) is cached until it changes.
  Plists over 256 KB are not read (they count as unreadable).
- Only ~/Library/LaunchAgents is read (Kosmos writes its own jobs there); /Library jobs are not. A start script on a
  hung network mount would block the survey's read; not handled.
- Each agent's answer is remembered until a login job, a launcher script or the home folder changes. Measured on the
  fleet Mac (about 80 agents, 40 login jobs): a cold survey about 22 ms, a warm one about 9 ms.
- Script text is matched ignoring case (the Mac's disks do), under the folder as written, its real path, and ~ or
  $HOME for both the OS home and Kosmos's own.
- Known inconsistency, not changed here: `create.jobMissing` (the offline card's "Made before Kosmos recorded this")
  still looks only at Kosmos's own plist, so an agent covered here can still get that card's no-job wording. A
  follow-up should move it onto this survey.
- Not covered, stated so nobody reads it as covered: a launcher that runs a SECOND script holding the folder (one hop
  only), the legacy OnDemand key, plist XML comments, a UTF-16 script (read as binary) or plist (read as not a plist), a relative script argument
  resolved against the job's WorkingDirectory, a relative `cd`, a folder built from variables other than HOME,
  a job switched off with `launchctl disable` (the override database, not the plist). A chained launcher, a relative
  `cd` and other variables read as missing (Repair would add a second job); OnDemand, comments and `launchctl disable`
  can read either way.
- Measured on the fleet Mac after these changes (read-only survey): 1 missing (leftover-unrelated, genuinely no job).
