---
method: challenge-loop
branch: restorerun-5536
diff_hash: aa754b0ab45f96f64bd339e8e4b63a9a8280ca11118f7de9c72aecec41ec9ad4
timestamp: 2026-10-25T18:02:23Z
iterations: 2
converged: true
---

# Challenge-loop proof: restorerun-5536 (kosmos#5536 slice 1)

The plan (.claude/plans/restorerun-5536.md) records the design and its correction.

#### Iteration 1 (blind security review)
No BLOCKER.
[WARNING, fixed] No clock allowance after the grant: a Mac clock a little fast refused a genuine backup for ever.
[WARNING, fixed] The week rule refused a genuine run across Monday 00:00 and a grantedPeriod retry; dropped, since the
period is in the device-signed context.
[WARNING, fixed] A six-hour tolerance refused a long first upload; now a period and a day (consistency only).
[WARNING, fixed] A restore that restored nothing came back ok: true; now ok only when files were restored.
[WARNING, fixed] No deadline on fetches; each is now cut off, and only bytes are accepted.
[NIT, fixed] Object keys must be this member's coordinator keys; missing inputs refused by name; the list sort and
bound; the header says the id-time check is consistency, not security, and states the residuals.

#### Iteration 2 (author, against the fixes)
No new finding above NIT. My old list fixture expected a 38-hour gap to be flagged; inside the new window it is not,
so the fixture moved to nine days. Every new behaviour has an arm.

### Final Ledger
- Converged at iteration 2. engine/restorerun-5536.test.js 7 pass; with the scanning guards 74 of 74.
- Full validation at fc1a295993: 23943 tests, 0 fail, VALIDATION rc=0 AUDIT rc=0.
- Seven mutation arms red, each restored; the no-timeout arm is not run (it hangs, the defect it guards).
