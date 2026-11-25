---
pre_challenge: true
method: challenge-loop
branch: oldline-9038
diff_hash: 22dae62a3afc74ebe7e2e29ddc339ebc79961d5813ca45cd4d0654b285aff3db
validation: passed
subdir_audit: passed
timestamp: 2026-11-25T14:06:58Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes (iteration 5: no blocker and no major; its minors fixed)
**Fixed:** every other finding | **Deferred:** 0 | **Asked (awaiting user):** 0

Validation: full run through the heavy queue at head 6a275629a0, validation_rc=0 audit_rc=0, rc=0 (08:06 CST 11-25): 31,231 tests, 0
failed, four of four shell shards. An earlier full run (38f31cc368) was red on check-frozen-roots, fixed in 6a275629a0 with no change
of behaviour. 55 mutations, all red, at 6a275629a0.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 1 BLOCKER, 1 MAJOR, 3 MINORs, 1 NIT --> FIXED
What was seen of a line outlived it: a restart or a new turn printing the same text read a revoked account calm. Also: the login date
could belong to a login the agent does not use.

#### Iteration 2
**New findings:** 3 MAJORs, 4 MINORs, 2 NITs --> FIXED by a redesign
The screen's text is no longer the evidence. It is the refusal's own time in the session's transcript, against the last read of the
earlier login date.

#### Iteration 3
**New findings:** 4 MINORs, 4 NITs --> FIXED, or declared in the plan
Variables that move the login's Keychain name, a clock set back, work on ticks that cannot use it, the real pane reader untested.

#### Iteration 4
**New findings:** 1 MAJOR, 1 MINOR, 2 NITs --> FIXED, the nits declared
Iteration 3's clock guard never ran in production, and its test went round the cache that hid it.

#### Iteration 5
**New findings:** 2 MINORs, 5 NITs --> FIXED, one nit kept
Other credentials are refused by shape, and tests for an error in the tick, another pane, a failed read and the exact moment.
