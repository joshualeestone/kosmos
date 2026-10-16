---
pre_challenge: true
method: challenge-loop
branch: wn-0753
diff_hash: 81566bb35a1f11c8dc4b59d1362d73582fb58b78c190a7a3957a20f868493383
validation: passed
subdir_audit: passed
timestamp: 2026-10-16T19:12:16Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (a blind accuracy review against the fix's code, joinid-6315 head 7ad6047506; the merged #6321 carries
engine/remote.js byte-identical to it)
**Converged:** Yes (nothing above MINOR; both MINORs fixed)
**Total findings:** 2 MINOR, 1 NIT
**Fixed:** all | **Declined with reason:** 0 | **Asked (awaiting user):** 0

Validation: Mortals full suite on 4be4d61e78 (this diff), clean: 21265 tests, 0 failed, 0 cancelled, 251 skipped.
Mortals hashed with ids at 9 (6cdc12f735b6); mortals-validate matched it to this diff (local 81566bb35a1f). The head
commit carries a Browser-check trailer, as earlier What's New commits do (#1720).

### Per-Iteration Breakdown

#### Iteration 1
- [MINOR] the line read as if updating the waiting computer were enough; the fix is in the FIRST computer's board -->
  FIXED (the line says "once that one has this update"; 128 characters, under the window's 140)
- [MINOR] (versions entry, not in this diff) "the way a former computer is" explained nothing --> FIXED in the entry
- [NIT] (versions entry) "allowed only with that code" holds for the new computer: ids only, which is the case it
  describes --> ACCEPTED
