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
  run's own TMPDIR ($W/tmp); the stand-ins live under it. Row pin 53 -> 57.
- Gate, earlier-gate leftovers (tunnel-gate.* copies):
  - one whose copied state NAMES this identity counts wherever it lives (any temp root);
  - one whose state cannot be read counts only under THIS gate's temp root
    (${TMPDIR:-/tmp}, trailing slashes tolerated), so one run's stand-in never holds another's;
  - a pid is skipped only when kill -0 says it is gone (both scans); a live pid whose command
    line cannot be read counts (fail closed), with a second kill -0 for the exit-between-reads race.
- New rows, each red under its own mutant: a foreign-root unreadable stand-in does not hold; a
  foreign-root stand-in naming this identity does; a really exited pid (pgrep shim) does not; a
  live pid with no readable command line (ps shim) does.

## Rejected
- My first proposal on the card (skip a connector whose state dir no longer exists): it
  contradicted the existing SIGKILLed-gate row and was not the mechanism measured.

## Weakest premise
- A leftover from a gate that ran under ANOTHER temp root AND whose copied state can no longer be
  read (its dir removed) is not seen. Stated in the gate's NOT COVERED header. One whose state
  still names this identity IS seen; review round 1 caught that my first version scoped those too.
