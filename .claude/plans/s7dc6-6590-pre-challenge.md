---
pre_challenge: true
method: challenge-loop
branch: s7dc6-6590
diff_hash: a4f66edb2aa145cafce56c180fa8d28727c3c138334bd2b3d7562459cbfe5169
validation: passed
subdir_audit: passed
timestamp: 2026-10-24T06:14:14Z
iterations: 1
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (a blind review of the whole part).
**Converged:** No: review 1's fixes (four WARNING, two NIT) were not re-reviewed; the two NITs it did not take are
decided in s7dc6-6590.md.
**Validation:** the Mortals full suite on head 51e0de1001, on main after c4 (#7019) merged: **23645 tests, 0 failed**
(hash a4f66edb2aa1, the diff this proof hashes). Its first run, at dff616db02, failed one test: the windows-tests-1777
guard (this part's test branches on a win32 host and nothing ran it on Windows). Fixed by adding it to the Windows run.
**NOT TO MERGE WITH AN ORDINARY BATCH.** This part writes the marker that switches c1 to c4 on, and it is one way for
the person's computer. Merge conditions in s7dc6-6590.md: relay #574 (met), c1 to c4 (met), the design review (met),
and a release of its own whose note states the cost in that plan.

### Per-iteration breakdown (details in s7dc6-6590.md)
#### Iteration 1: 0 BLOCKER, 4 WARNING, 4 NIT
- [WARNING] the hold matched only exactly 0 --> FIXED (anything but unset, 1 or on holds it)
- [WARNING] a lasting failure logged every tick --> FIXED (said once per error)
- [WARNING] a failed rename left its temporary file --> FIXED (removed; wx)
- [WARNING] the no-removal guard could not match --> FIXED (three named uses, none removing; ensure() and default
  capability pins)
- [NIT] written while waiting for an older computer's Allow --> FIXED; the comment --> FIXED; two DECIDED (see the plan)
Seven mutants, each red on its own test.

### Weakest premise
That the tunnel and the board agree on what the marker is: both read it as "something is at the path" (kosmos-relay
gatev2.rs, `.exists()`). The busy() arm of the write is unpinned, as in c2 and c3.
