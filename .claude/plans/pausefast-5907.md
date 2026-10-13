# pausefast-5907: the sandbox-pause test says its port waits instead of sleeping them (#5907)

Card: joshualeestone/kosmos#5907 (suites run 30-36 min). `tools/test-setup-pause-sandbox-4651.sh` was measured at
190 s in a queued run on main, one of the slowest shell files left after #5938's family.

## Where the time went
Timed per case on main (a copy with a clock around each `chk`, run from the worktree): 13 cases took 12 to 16 s
each, the rest under 1 s. Those 13 are every case where a listener holds the port outside a sandbox or under profile
A (under B and C lsof fails, so the loop stops at once; a reviewer counted the waits per call: 13 calls wait ten
times, 11 never). The lifted pause block waits for a stopping board with up to ten `sleep 1`s
(`while [ "$_tries" -lt 10 ]`), and no stub listener ever lets go of its port (they live 120 s), so each such case
slept the full 10 s. (An earlier draft of this plan said 12: a miscount of the same timing table.) The other 2 to 6 s per case is the block's own
`curl -m 2` probes against a silent listener.

## The change
- `run.sh` (the harness's wrapper, not the product) defines `sleep() { echo "WAITED $*"; }` before it sources the
  block. The loop still makes its ten `lsof` checks; only the second between them is gone. Printed, not written to a
  file, because profile C denies temp writes.
- The `curl -m 2` probes are left real: what curl answers to a silent, banner or `::1` listener is what the test is
  about.
- New check: on a held port (the silent-listener control) the output has exactly ten `WAITED 1` lines. It proves the
  stub is reached (a real `sleep 1` prints nothing) and pins the ten tries. New control: a free port prints no
  `WAITED`.
- `install/setup.sh` is unchanged.

## Proof
- Before: 190 s, 33 PASS. After: 47 s, 35 PASS (the 33 plus the 2 new), 0 failures.
- Mutation: `-lt 10` to `-lt 3` in setup.sh's loop turns exactly the new ten-waits check red; restored (empty diff).
- Reasoned, not run: removing the stub turns the ten-waits check red, since a real `sleep` prints nothing.

## Weakest premise
That no case needs the wait to really elapse. True today because no listener exits during a run; a future case that
stops its listener mid-wait to test the "board let go in time" path would need a real sleep (or a stub that also
stops the listener) and would see the stub here first.
