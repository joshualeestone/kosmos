# leakctl-6671: the leak guard's outside control cannot be failed by a stray pkill (kosmos#6671)

**Card.** tools/test-test-leak-guard-4273.sh failed once on main under load at "a process outside the root is left
alone (control)", then passed on five more runs at higher load. The control is a `sleep 60` started by the test, and the
failure means it was dead when checked.

**What can kill it.** The guard (leak_process_check) stops only orphans (parent pid 1) whose command line names the
fixture root; the control is this shell's child and names no root, so the guard cannot select it. Something outside the
test can: this machine is shared, and on 2026-10-20 at 05:50 CDT a helper ran `pkill -f "sleep 6"`, which matches
`sleep 60` (that incident is after this failure, so it is an example of the class, not proof of this one).

**The call.** Make the control a 60 s wait with no "sleep" in its command line: `perl -e 'select(undef, undef, undef,
60)'`, which still ends by itself if the test is killed before its cleanup runs. The same exposure is in
tools/test-start-waits-for-starting-board-6586.sh's `victim()` (an orphaned `sleep 60` stand-in board, found in review 1),
changed the same way. Rejected: retrying the check (it would hide a real guard bug that kills the control); a uniquely
named sleep (still a `sleep N`, and `pkill sleep` matches any); `tail -f /dev/null` (the first version: it never ends,
so an orphan that cleanup misses, as `victim()` makes on purpose, would run forever).

**Scope, decided (review 2; the list replaced a hand count in review 4).** `grep -nF 'sleep 6' tools/test-*.sh` (the
same substring rule `pkill -f "sleep 6"` uses) returns 23 lines: 3 are this branch's own comments, and the other 20 are
in four files, as lines to check rather than confirmed exposures: test-cut-guard.sh 651, 678, 1078, 1098, 1142, 1183; test-light-side-4911.sh 19, 20, 23, 179, 279, 303, 308, 335, 354, 357; test-queued-heavy-4977.sh 177, 319, 352; test-tunnel-handshake-gate.sh 88. More `sleep 30`/`sleep 300` controls match
only a broader `pkill sleep`. All are left for kosmos#6710: several record their own command line (pid-reuse checks),
stand in for a live git, are renamed with `exec -a`, or sit inside a quoted script or a perl one-liner, so each needs
checking rather than a swap, and none has failed yet.

**Also in the diff.** test-start-waits-for-starting-board-6586.sh line 117 is split in two (behaviour unchanged): it read
a status and piped into a filter on one line, which the pre-commit pipe lint refuses for any changed file.

**Done when.** Neither control is a sleep, both whole files pass, the leak-guard control still fails when its process
is killed (mutation), and no wait process is left running after either file.

## Tests run
- tools/test-test-leak-guard-4273.sh whole file: 77 ok, 0 FAIL, rc 0.
- tools/test-start-waits-for-starting-board-6586.sh whole file: 25 PASS, 0 FAIL, "all passed".
- No wait process left running after either (pgrep for the perl wait: 0).
- Mutation (a copy outside the tree): killing the outside process before the check gives
  "FAIL the guard killed a process outside the root".

**Weakest premise.** That the one failure was an outside kill. I cannot show what killed it on that run; if the guard
itself ever kills a non-orphan, this control still catches it, since only the process's name changed.
