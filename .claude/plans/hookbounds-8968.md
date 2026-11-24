# hookbounds-8968: report-hook timing tests bound the behaviour, not load-scaled wall clock (kosmos#8968)

## Goal
Three timing checks went red in full local runs on a loaded Mac (15-minute load 22 to 25) and passed alone:
engine/kosmos-report-hook.exit-8014.test.js (stdin backstop at 10359 ms against < 6990; the stalled keep-copy body at
1574 ms against < 1500) and engine/kosmos-report-hook.win32-killguard-8406.test.js "long lines stay fast" (2737 ms
against < 1500). Each is a total wall-clock ceiling, which load stretches. The card asks for bounds that still red
when the guarded slowness returns and do not red under load, and says not to widen them with scaleBudget.

## Change
- exit-8014: the fake board records when each request arrives. The three "did not wait for the 2 s backstop" checks
  bound the tail, from the board's last request to the child's close, below 1950 ms. The 2 s exit timer is set only
  after the hook's last answer, so a run that waits for it cannot have a tail under 2000 ms.
- exit-8014 keep-copy arm (review round 1): the tail cannot see a hook that WAITS on the stalled body before its last
  request (it would sit until the 3 s keep abort, then report). So that arm also bounds the gap from the board seeing
  /api/undo/keep to the hook's next request or close, below 1950 ms, beside the tail bound.
- exit-8014 stdin arm: keeps "ended no earlier than 4500 ms"; the 5 s stdin backstop is timed from a preload's start
  mark (node -r, a file in the test's temp dir) to the first board request, between 4500 and 8000 ms, so a slow node
  start does not count and a 10 s backstop still reds.
- win32-killguard-8406 "long lines stay fast": process.cpuUsage (user + system) instead of Date.now, as
  engine/backupscan.test.js already does. A runaway pattern spends CPU; load only stretches wall time.

## Tests
- Both files pass (11 of 11) on this Mac at load 17.
- Mutants, each run and restored (worktree clean after):
  - 2 s exit timer not unref'd (the regression the exit-8014 checks guard): 3 of 3 red, tails 2005 to 2007 ms.
  - keepCopy awaits the stalled body (res.text() for res.body.cancel()), the shape the round-1 reviewer found the tail
    alone passed at 3057 ms in all: red on the keep gap.
  - stdin backstop 10 s: the stdin arm reds, "ran the hook 10013 ms after it started".
  - guard burns 1.6 s of CPU on a long line: "took 1639 ms of CPU", red.
  - Control: guard sleeps 1.6 s (wall time, no CPU, the shape load gives): 8 of 8 pass, where the old check reds.

## Weakest premise
The tail bound has only 50 ms of headroom on the red side by design (the regression is at least 2000 ms) and about
1.9 s on the green side; a machine that takes almost 2 s to tear a node process down after its last answer would red
it. That is far beyond the 10 s run that prompted this card, which had a 5 s backstop plus about 5 s of slow start.
cpuUsage counts every thread in the test process (GC included), which a loaded machine inflates a little, not 2x.
