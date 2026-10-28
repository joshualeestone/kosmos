# signinhint-7493: the start-at-sign-in switch says it is also the crash-recovery switch (kosmos#7493)

**Call: (a), one switch, and it says both things it does.** Under "Start Kosmos when I sign in to Windows" the row
now reads: "This also restarts Kosmos if it closes unexpectedly. Turned off, Kosmos stays closed until you open it."
The switch carries aria-describedby to that sentence.

**Rejected: (b), a separate "stopped on purpose" marker for the watchdog.** Task Scheduler does not /Run a disabled
task, so (b) cannot leave the board task disabled and still recover a crash. It would have to move the sign-in
switch from the task's Enabled to its logon trigger's Enabled (re-registering the task XML), teach status(),
ensureInstalled's five states and watchdog rule d the difference, and migrate every install already switched off.
That is a durable-state change on a Windows path I cannot exercise here. The existing holds (board-hold.<pid>.json)
cannot be the marker: they live at most 5 minutes and only while their owner runs. The Mac couples the two as well
(one LaunchAgent does RunAtLoad and KeepAlive), so (a) matches it.

**Weakest premise:** that a person who turns off start-at-sign-in is fine without crash recovery once told. Someone
who wants Kosmos only when they open it, but kept up after a crash, is not served. If that is asked for, build (b).

- Tests: web.win32-start-at-sign-in.test.js pins the hint on and off, the aria-describedby, and that no switch means
  no hint (control). Mutation: breaking the hint's id turns the new test red (7/8), restored 8/8.
- Every web test on this head: 3404/3404 (427 files).
