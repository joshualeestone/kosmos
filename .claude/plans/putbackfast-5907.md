# putbackfast-5907: tools/test-update-putback-4818.sh, 70 s to 10.5 s (#5907)

Card: joshualeestone/kosmos#5907 (full suites about 30 min against the documented 14 to 26).

## Where the time was (measured)
60 of the test's 70 s were five #5033 refusal cases at about 12 s each (per-line timing). Timestamps around each step
of one case put all 12 s in `"$KOSMOS_HOME/bin/kosmos" stop --force`, and a timestamped `bash -x` of that call showed
13.85 s on one line, run 202 times: the test's OWN fake kosmos (written by home() into $H/bin/kosmos), whose `stop`
waits up to 50 rounds (a curl, then 0.1 s) for the port to go quiet. In these cases another app or another Kosmos
holds the port, so it never goes quiet and every round runs.

## The call
The fake `stop` waits for the port only when it killed our own board (a board.pid). With nothing of ours running it
returns at once, which is also what the real `kosmos stop` does with no pidfile of its own (it decides with one
`healthy --once` probe and does not wait for a port it never held). No production code changes.

## Proven
- The same 33 assertions pass, in the same order (diff of the PASS/FAIL lines against main's run): 70.4 s on main,
  10.5 s on the branch.

## Weakest premise
That no case meant the fake to wait on a port it did not hold. The five slow cases assert on setup.sh's refusal and
its marker handling, which the wait never touched; their assertions are unchanged and pass.
