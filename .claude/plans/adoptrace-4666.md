# adoptrace-4666: the UNTAGGED adopt test waits for the first launch's sweep

Card: joshualeestone/kosmos#4666 (supervisor.retire-token-4530 "UNTAGGED, adopt" failed a logic assertion under load, passed alone).

## Finished means
The arm cannot fail because of how long the first launch's sweep takes, and it still fails when adopting a live run retires an untagged token.

## Cause (measured)
bin/agent-supervisor.sh records the run on its session (@kosmos_token_instance, the file the test waits for) and only then runs the untagged sweep, in a `$(token_store sweep ...)` node process. The test SIGKILLs the supervisor as soon as the instance appears. A SIGKILL of bash does not stop that node process, so a sweep that had not finished went on to retire the untagged token the test mints next. Load only widens the window.

Reproduced: a copy of the supervisor with `sleep 1.5` before the sweep fails the unchanged arm every time, with the card's message ("adopting a live run retired an untagged token"). The shipped supervisor passes it.

Not a product race: in the product that sweep is the launch retiring pre-#4530 untagged tokens, which is its job. Nothing in the product mints an untagged token for a live run in that window that the launch was not already going to retire.

## Change
The arm mints an untagged token before the first launch and waits until the sweep has retired it (a CONTROL assertion) before the kill. The kill then always lands after the sweep.

## Measured, four arms (same test, SUPERVISOR_UNDER_TEST)
- A shipped supervisor: pass.
- B sweep delayed 1.5 s (the flake): pass (was fail before the change).
- C sweep removed: fail, "CONTROL: the first launch's sweep never retired an earlier untagged token".
- D adopt path runs an untagged sweep (the bug the arm guards): fail, "adopting a live run retired an untagged token".
Whole file on the shipped supervisor: 15/15.

## Weakest premise
That no other writer retires untagged tokens between the kill and the adopt. The arm's own fixture has no other writer; if one is added, this arm needs the same wait.

## Rejected
A longer fixed sleep before the kill: it only moves the window.
Waiting on the first supervisor's child processes: they are not visible to the test, and the sweep's effect is.
