# pgrepfail-9149: a failed process scan is not "no connector" (kosmos#9149)

Owner: Renet Tilley (assigned by Splinter 11:32). Card: kosmos#9149.

## Goal
tools/test-tunnel-handshake-gate.sh went red 3 of 22 Mortals runs, each on a different stand-in arm, with the gate
PASSING while a stand-in connector of its identity ran. Every Mortals validation could hit it.

## Steps
- [x] tools/tunnel-handshake-gate.sh: both connector scans through _gate_pgrep: pgrep's exit 0 or 1 as before; any
      other is retried twice, each failure said on stderr with its code and pgrep's own words, then CANNOT TELL (exit 2
      named as a gate defect). Its error file is inside WORK, which the EXIT trap removes.
- [x] tools/test-tunnel-handshake-gate.sh: 7 rows (64): always fails, no lock left, fails once (retried and still
      sees it), a rescued failure is said, the second scan's failure, exit 2, no temp file left. Each behaviour row is
      red against main's gate or the matching mutation.
- [x] 2 blind review rounds, both with no BLOCKER or MAJOR.
- [x] Full validation through queued-heavy: PASSED on 0305bae223.
- [ ] PR, merge. Keep the card open until a Mortals red (or its absence over a day) says whether pgrep failing was
      the cause: the new stderr lines tell "pgrep failed" from "pgrep found nothing".

## Decisions
- Fail closed (CANNOT TELL), not retry the whole test: a retry would hide the false PASS instead of removing it.
- Weakest premise: that pgrep FAILING (exit 2 or 3) is the cause. A reviewer reproduced exit 3 on this macOS
  (sysmond unavailable) and found no exit-0/1 miss in 2,500 probes, but it is not shown on Mortals. A process
  listing that returns a short list with exit 1 would not be caught by this.
