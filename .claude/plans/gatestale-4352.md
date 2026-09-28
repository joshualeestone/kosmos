# gatestale-4352: the release gate's test goes CANNOT TELL when two runs share a Mac (kosmos#4352)

## Measured, not guessed (2026-09-28, Agent1s)
Two copies of tools/test-tunnel-handshake-gate.sh run at once: one went 51/2, both reds
"another connector with the gate's identity is still running". Alone: 53/0. Two mechanisms:
1. The test's gate address was a constant (gate-test.kosmos.test), so a concurrent run's live
   stub had a READABLE address equal to ours and the gate rightly counted it.
2. With (1) fixed, three concurrent copies each still went 52/1 at DIFFERENT cases, with
   `line 217: /address: No such file`: a connector found by pgrep had exited before `ps` read its
   command line, so its state dir read as empty ("unreadable, could be ours"); and one run's
   deliberate SIGKILLed-gate stand-in was visible to every other run.

## Fix
- Test: a per-run gate address from the run's own temp dir, and every gate it starts gets the
  run's own TMPDIR ($W/tmp); the stand-ins live under it. Row pin 53 -> 55.
- Gate: only connectors under THIS gate's temp root (${TMPDIR:-/tmp}/tunnel-gate.*, trailing
  slashes tolerated) are considered earlier gates' leftovers; a pid whose command line is gone by
  the time ps reads it is skipped. The "unreadable state still counts" rule is unchanged.
- New rows: a stand-in under another temp root does not hold (PASS); a connector that exited
  before its command line was read does not hold (PASS, via a ps shim). Each is red under its
  own mutant.

## Rejected
- My first proposal on the card (skip a connector whose state dir no longer exists): it
  contradicted the existing SIGKILLed-gate row and was not the mechanism measured.

## Weakest premise
- That a SIGKILLed gate's leftover connector always sits under the same TMPDIR as the next
  gate. True for one user running the gate from one environment; a gate run under a different
  TMPDIR (another shell, sudo) would not see it. The lock on the state dir still stops two gates
  on the same identity at once.
