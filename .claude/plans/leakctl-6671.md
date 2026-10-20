# leakctl-6671: the leak guard's outside control cannot be failed by a stray pkill (kosmos#6671)

**Card.** tools/test-test-leak-guard-4273.sh failed once on main under load at "a process outside the root is left
alone (control)", then passed on five more runs at higher load. The control is a `sleep 60` started by the test, and the
failure means it was dead when checked.

**What can kill it.** The guard (leak_process_check) stops only orphans (parent pid 1) whose command line names the
fixture root; the control is this shell's child and names no root, so the guard cannot select it. Something outside the
test can: this machine is shared, and on 2026-10-20 at 05:50 CDT a helper ran `pkill -f "sleep 6"`, which matches
`sleep 60` (that incident is after this failure, so it is an example of the class, not proof of this one).

**The call.** Make the control a process that no sleep-aimed pattern matches: `tail -f /dev/null`, also long-lived and
also killed by the test's cleanup. Rejected: retrying the check (it would hide a real guard bug that kills the control),
and a uniquely named sleep (still a `sleep N`, and `pkill sleep` matches any).

**Done when.** The control process is not a sleep, the whole file passes, and the control still fails when its process
is killed (mutation).

## Tests run
- Whole file: 77 ok, rc 0; no `tail -f /dev/null` left running afterwards.
- Mutation (a copy outside the tree): killing the outside process before the check gives
  "FAIL the guard killed a process outside the root".

**Weakest premise.** That the one failure was an outside kill. I cannot show what killed it on that run; if the guard
itself ever kills a non-orphan, this control still catches it, since only the process's name changed.
