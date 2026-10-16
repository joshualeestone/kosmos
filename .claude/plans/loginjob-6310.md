# loginjob-6310: an agent started at login by its own LaunchAgent is not "missing"

Card: #6310. Owner: Angel.

## Done means
On a Mac where agents start at login from LaunchAgents Kosmos did not write, the Agents tab does not count them as
"will not come back", and Repair writes no second job for them. An agent with no login job anywhere is still counted
and still repaired. A login job that cannot be read leaves the answer unknown (shown, never repaired).

## Steps
1. [x] `engine/register.js` `jobReader` (Mac): our plist, OR a non-Kosmos LaunchAgent (RunAtLoad or KeepAlive, not
   Disabled) whose WorkingDirectory is the worker folder, OR a KeepAlive job whose arguments or named start script
   (64 KB or less) contain the whole worker folder path. Plist XML read as text (no process on the 5 s poll); binary
   plists through plutil; cached by mtime and size.
2. [x] Tests in `engine/register.test.js`: the fleet shape with a no-job control; disabled, never-starting and
   other-folder jobs do not cover; unreadable plist gives null; a start-script mention covers a KeepAlive job, not a
   periodic one, and `.../leo` does not match `.../leonardo`.
3. [x] Measured on the fleet Mac (read-only survey): 0.7.51 says 18 missing, this branch says 2 (both genuinely have no
   login job).

## Decided, not missed
- Matching by folder, not by label (`com.<name>.discord`): the label is this fleet's habit; the folder is what makes a
  job start THIS agent.
- Periodic jobs never count even if their script names the folder: a digest that `cd`s into a worker folder does not
  bring the agent back.
- Weakest premise: a job switched off with `launchctl disable` (the override database, not the plist) is not read, so
  it would count as covered. Reading the override database needs a `launchctl print-disabled` call per poll; left out.
