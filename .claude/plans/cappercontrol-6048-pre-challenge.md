---
pre_challenge: true
method: challenge-loop
branch: cappercontrol-6048
diff_hash: ede390ee0f7b23a616828f615a50656d8cd7fe4efcbe904b32dacdf6f217812b
validation: passed (local full validation via queued-heavy, validation-log hash ede390ee0f7b, 2026-10-14 07:26 CDT; queued-heavy-4977 142 OK, the CONTROL held, got 1)
subdir_audit: passed
timestamp: 2026-10-14T12:27:59Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6, alternating opus (odd) and sonnet (even). **Converged:** Yes, iteration 6 returned NO FINDINGS.
Diagnosis only: the cause of the once-seen CONTROL "got 0" is not established; the arm now records its shape.

### Iteration 1 (opus)
- [BLOCKER] The claimed cause was wrong (the EXIT trap reaches the same uninterruptible wait; a bash 3.2 replica held in every timing), so the reorder is reverted. Instead the CONTROL records its shape: reap says how it decided and the wrapper's exit status, side5331 records each attempt, why one never started and the capper's state, and a BAD prints that, whether the teardown said claim released, and the whole log.

### Iteration 2 (sonnet)
- [BLOCKER] ok() takes its tail length from OTAIL, so the CONTROL's BAD prints its log, whether the teardown said claim released, and the record (last); the exited branch records the raw ps stat, and exit 127 says not this shell's child.

### Iteration 3 (opus)
- [WARNING] notours says alive or gone and, for a gone wrapper, records its exit status; the record notes the wrapper's and capper's stat before the TERM and the claim-released count right after the reap; the bound branch says when it sent no KILL. The plan reads the job log as a wrapper SIGKILLed from outside.

### Iteration 4 (sonnet)
- [NIT] A missing log reads 'no log' in the record; the comment says the stat is trimmed; the plan says when notours waits.

### Iteration 5 (opus)
- [WARNING] The claim-released count no longer appends 'no log' on zero matches (grep -c exits 1 there); the never-started STOP line records the stat that failed the test, read once.

### Iteration 6 (sonnet)
NO FINDINGS.

