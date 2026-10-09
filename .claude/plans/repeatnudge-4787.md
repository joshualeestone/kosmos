# repeatnudge-4787: the idle nudge names a repeating task's due run and how to record it

Card: kosmos#4787 (recurring work as a first-class task). Slices 1 to 3 are served in 0.7.28 (cadence, last and next
run, missed runs shown, the named reviewer told once per missed run; #5456 "On a schedule"; #5643 unchanged runs).
Left by the 10-08 feedback: missed runs should recover without a manual rerun and note.

## Measured on main (before building)
- A repeating task between runs holds no work (waitingForNextRun); once its slot is due it is open work again, so
  the idle owner IS nudged (agentnudge.openParts) and the named reviewer is told once when it is missed (missedtell).
- The nudge's line is the generic "you have been idle while you still have open work: task #N ... Pick it up": it never
  says a scheduled run is due, nor how to record it, so the run can be redone and not recorded (the reported gap).

## Done looks like
A due repeating task's nudge says "Its scheduled run (<when>) has not been reported: run it now, then record it with
kosmos task ran <project> <n> (add --unchanged if it found nothing new)." A plain task's line is unchanged.

## Decisions
- Recovery stays the owner's (Kosmos does not start jobs: taskrepeat's own rule); the nudge is the existing recovery
  path, made specific. Rejected: Kosmos re-running steps or making them atomic (it does not run them).
- "All steps complete together" is the agent's own procedure; the rules (v26) already teach recording a run that could
  not check as blocked, not unchanged.
- Weakest premise: an agent busy elsewhere is never nudged (the nudge waits for idle), so a busy owner's missed run is
  recovered only by the reviewer told (slice 3) or the person; that is the nudge's long-standing rule, not changed here.

## Verification
- engine/agentnudge.test.js: the due line (red by mutation), CONTROLS for a plain task and a task between runs.
- agentnudge, taskrepeat and missedtell suites 71/71.

## Review log
- **Round 1 (opus):** 0 blockers, 2 warnings, 2 NITs.
  - W1 fixed: after a long gap the line named the FIRST unrun slot (days old) while `task ran` answers, and the reviewer's line names, the latest. It now names the latest due slot, with "and earlier ones" when more are outstanding (red by mutation).
  - W2 fixed: the test accepted any words in the parentheses; it now asserts the exact slot, a 72-hour gap, and a future-stamped run with no slot (plain line).
  - NIT taken: with no usable project id the command shows `<project-id> <task-number>`, never a bare verb. NIT left: the slot uses the real clock like the waitingForNextRun check beside it.
- **Round 2 (sonnet):** nothing above WARNING; the sentence holds in every state traced (and names the same latest slot as missedtell's line). W fixed: "and earlier ones" had no absence test; a one-outstanding-slot fixture asserts it is not said (red by mutation). NITs left: a one-in-millions clock-boundary race in the test's recomputation; placeholders and `part.n` follow existing patterns. Converged.
