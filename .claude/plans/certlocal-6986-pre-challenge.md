---
pre_challenge: true
method: challenge-loop
branch: certlocal-6986
diff_hash: f94f7da53804b94496e09bc17cec716bbde31f8f20a5893b65bea43c727db9eb
validation: passed
subdir_audit: passed
timestamp: 2026-10-23T13:39:44Z
iterations: 1
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1.
**Converged:** No, only because round 1's three nits were fixed (two in code, one decided) and not re-reviewed. Round 1 found no BLOCKER and no WARNING. The two code nits are small and each has a test that goes red with it reverted.
**Validation:** the Mortals full suite on head 5c8375a089: **23518 tests, 0 failed**. Validation hash f94f7da53804 is the same diff this proof hashes.

### Per-iteration breakdown (details in certlocal-6986.md)
#### Iteration 1: 0 BLOCKER, 0 WARNING, 3 NIT
- [NIT] an unreadable remote change answered 400 "could not read" --> FIXED (403 remote_not_allowed from the parse's catch)
- [NIT] the bare Forwarded: header was untested --> FIXED (test arm)
- [NIT] the page explains only after a press --> DECIDED, kept (as #6595's Allow; server-only change)

### Weakest premise
isRemoteRequest reads forwarder headers; a request with none of them is local, the boundary every #6595 route relies on.
