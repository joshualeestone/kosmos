# winroster-8410: the Windows halves of #6173 and #668 (kosmos#8410)

## Item 1, #6173: the board keeps turning while the roster is read (test only)
On Windows the roster is `claude agents --json`, read through win32roster's shared cached reader. status.paneRosterAsync
calls a pane source synchronously, so the board keeps turning because the cache serves a stale answer at once and reads
again in the background. `engine/win32roster.board-turns-8410.test.js` pins that through the real status.js, with the
background read a real child process that takes 300 ms. The control: a cold cache reads synchronously and the board
does not turn at all. A regression that drops the stale path fails at once and never hangs (measured with that mutant).

## Item 2, #668: a running supervisor with no visible session is could-not-check (a fix, not only a test)
Found while writing the test: `create.runningJobs()` had no Windows arm. Windows fell into the Mac arm, ran
/bin/launchctl, the call failed and the answer was empty, so every such agent read a confident "Not running".
- `win32streamstate.liveNames()` returns the agents whose supervisor's own state file names a live pid
  (liveIdentity, then pidAlive): the same signal win32job.runningSteps reads after a start.
- `create.runningJobs()` uses it on win32 and never runs launchctl there. Mac and Linux are unchanged.
- `engine/create.runningjobs-win32-8410.test.js`: a running supervisor reads as running, and its row as could-not-check.
  Controls: a parked task (no state file), a dead supervisor's leftover file, unreadable files, no state folder, and
  launchctl never called on win32 (while still called on darwin).

## Rejected
schtasks `/Query` "Status: Running": the text is localized and fires on the conhost wrapper before the supervisor is up.

## Weakest premise
That "the supervisor is up" is Windows' meaning of "the job is running". On a Mac, launchctl's PID column is the same
kind of fact (the job's own process, not Claude's). Also: the state file is named by the agent's store key, which for
a valid agent name (create's NAME_RE) is the name itself. That is reasoned from the code, not measured on a real
Windows board.
