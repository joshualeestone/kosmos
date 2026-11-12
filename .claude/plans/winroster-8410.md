# winroster-8410: the Windows halves of #6173 and #668 (kosmos#8410)

## Item 1, #6173: the board keeps turning while the roster is read (test only)
On Windows the roster is `claude agents --json`, read through win32roster's shared cached reader. status.paneRosterAsync
calls a pane source synchronously, so the board keeps turning because the cache serves a stale answer at once and reads
again in the background. `engine/win32roster.board-turns-8410.test.js` pins that through the real status.js, with the
background read a real child process that takes SLOW_MS (2000 ms): the request itself is timed and must return within
half of that, with the read started and still running. The control: a cold cache holds the request for the whole
synchronous read, and the same timing sees that. A regression that drops the stale path fails at once and never hangs.

## Item 2, #668: an agent whose process is up with no visible session is could-not-check (a fix, not only a test)
Found while writing the test: `create.runningJobs()` had no Windows arm. Windows fell into the Mac arm, ran
/bin/launchctl, the call failed and the answer was empty, so every such agent read a confident "Not running".
- `win32streamstate.liveNames()` returns the agents whose state file names a live pid (liveIdentity, then pidAlive),
  leaving out a file written before this boot (a reboot leaves files, and Windows reuses pids).
- `create.runningJobs()` uses it on win32 and never runs launchctl there. Mac and Linux are unchanged.
- Tests: running reads as running, and its row as could-not-check. Controls: a parked task (no state file), a dead
  process's leftover file, a file from before boot, unreadable and non-state files, no state folder, the real pid check
  (this process and an exited child), and launchctl never called on win32 (while still called on darwin).

## Not covered, and why (review 1)
For a Claude agent the state file names the CHILD's pid, not the supervisor's, and is cleared when the child exits.
So a supervisor that is up BETWEEN children (restarting after a crash, or waiting on blockedBy) still reads "Not
running", exactly as before this change: no regression, but not the Mac's wider answer either. Closing it needs the
supervisor to record its own pid: kosmos#8415.
Review 2, also left to #8415: a pid reused within one boot (a task stopped by killing its tree leaves the file), and
Fast Startup (uptime counts from the last FULL boot, so the boot rule does not see a hibernated shutdown). Both err
toward "could not check", the side #668 asks for. Telling the agent's own process from a stranger needs more than a
pid, which the supervisor's own presence record can carry. Not done here, because it changes the Windows supervisor that runs on
people's machines, and I have no Windows machine to watch it on.

## Rejected
schtasks `/Query` "Status: Running": the text is localized and fires on the conhost wrapper before the supervisor is up.

## Also found, not in this change
kosmos#8417: `disabledJobs()` has the same launchctl-on-Windows shape, so a switched-off Windows agent never shows as switched off (review 3).

## Weakest premise
That a live agent process the roster cannot see is the case worth fixing first, ahead of #8415's window. And that the
state file is named by the agent's store key, which for a valid agent name (create's NAME_RE) is the name itself.
Reasoned from the code, not measured on a real Windows board.
