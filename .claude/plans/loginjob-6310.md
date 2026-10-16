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
- A start script that exists but cannot be read, or text over 2 MB, may be any agent's launcher, so every agent
  without its own plist is unknown. A binary over the limit (the interpreter itself) is skipped. The limit was 64 KB
  until a read-only survey of the fleet Mac showed real launchers of 109 KB, 110 KB and 375 KB (Kosmos's own board).
- Deferred, not missed: when agents are unknown the banner shows only proven absences, so it can go quiet. Telling the
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
- A file that could not be read is asked again on the next survey (a failed read is not cached); one that read but is
  not a property list is cached until it changes. Plists over 256 KB are not read (they count as unreadable).
- Only ~/Library/LaunchAgents is read (Kosmos writes its own jobs there); /Library jobs are not. A start script on a
  hung network mount would block the survey's read; not handled.
- Not covered, stated so nobody reads it as covered: a relative `cd`, a folder built from variables other than HOME,
  a job switched off with `launchctl disable` (the override database, not the plist). The first two read as missing
  (Repair would add a second job); the last reads as covered.
- Measured on the fleet Mac after these changes (read-only survey): 1 missing (leftover-unrelated, genuinely no job).
