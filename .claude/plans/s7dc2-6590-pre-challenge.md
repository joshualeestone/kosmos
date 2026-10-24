---
pre_challenge: true
method: challenge-loop
branch: s7dc2-6590
diff_hash: 42f581794b278a95ca02a5f7a90ffe478630a9e7692a7d0b2c0f6476218207f9
validation: passed
subdir_audit: passed
timestamp: 2026-10-24T00:02:30Z
iterations: 1
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (a blind review of the whole part).
**Converged:** No, only because review 1's fixes (one WARNING, one NIT) were not re-reviewed; the third finding is
decided in s7dc2-6590.md.
**Validation:** the Mortals full suite on head cd47eb8aad, rebased onto main after c1 (#6992) merged:
**23614 tests, 0 failed** (hash 42f581794b27, the diff this proof hashes).
**Inert:** nothing here changes behaviour until the board-v2 marker exists (a later part writes it); without the marker
this computer's own sign-in is allowed exactly as before, and a test pins that path.

### Per-iteration breakdown (details in s7dc2-6590.md)
#### Iteration 1: 0 BLOCKER, 1 WARNING, 2 NIT
- [WARNING] the own-sign-in ack skipped the busy guard the Allow path has --> FIXED (the same guard; not tested, stated)
- [NIT] an unknown-device ack logged a vaguer sentence --> FIXED
- [NIT] the marker read can race a Forget --> DECIDED (harmless; see the plan)

### Weakest premise
That nothing else relies on this computer's own sign-in being on the allow list; under the marker the tunnel admits by
key, so such an entry admits nobody anyway.
