---
pre_challenge: true
method: challenge-loop
branch: policyapply-5534
diff_hash: 3206a1b2548450ac6fd24ef4800d2e2a91cf195a9cec39b804e25cc4f99fb5fd
validation: passed (rebased on origin/main and re-run; engine/orgpolicy-apply-5534 (14 tests), orgpolicy-5534, orgenroll-5531, orgenroll-print-5532, server.orgenroll-5531, engine/create, plus the reachable, 4796 sandbox, brand, name, fixture-discipline and Windows guards, 0 fail; red by mutation: last-admin re-apply, unserved-policy handling, join-by-code clear, refresh company switch, leave restore and restore-first order, version marks kept across a clear, takePolicy's foreign check, the waiting other-company bundle, and null never lifting)
subdir_audit: passed
timestamp: 2026-10-09T22:40:42Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 (opus, sonnet, opus+sonnet, sonnet, opus, sonnet, opus; each blind)
**Converged:** Yes (iteration 7: one WARNING, a duplicate of the documented pending-leave decision; the rest NITs, three fixed)
**Total findings:** 0 BLOCKERs, about 17 WARNINGs, about 20 NITs
**Fixed:** every WARNING except the three recorded as decisions in the plan | **Asked (awaiting user):** 0

The change (kosmos#5534, E0.5 board slice): an enrolled board applies the signed company policy its org-status answer
carries, so a policy that disallows a provider stops a new agent on it, and a tampered or foreign-signed bundle is refused
with the last good one kept.

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [WARNING] the policy outlived the enrollment --> FIXED (cleared in clearEnrollment).
- [WARNING] applied before the record was saved --> FIXED. [WARNING] no apply on a settled join or right after a join --> FIXED.
- [WARNING] another company's bundle could be saved --> FIXED. [NIT] folder mode, stale header --> FIXED.

#### Iteration 2 (sonnet)
- [WARNING] a policy no longer served stayed in force --> FIXED, later revised in iteration 5.
- [WARNING] a refused last-admin leave dropped the policy of a still-enrolled board --> FIXED.

#### Iteration 3 (opus and sonnet)
- [WARNING] a company switch with a refused bundle kept the old company's policy --> FIXED (ended before apply).
- [WARNING] a join by code to another company kept the old policy --> FIXED. [WARNING] join answered before the policy --> FIXED (awaited, 5 s cap).
- [WARNING] refused leave from an older coordinator dropped the policy --> FIXED (snapshot and restore).
- [CONVENTION] clear() threw away the version marks --> FIXED. [CONVENTION] stale orgpolicy.js header --> FIXED.

#### Iteration 4 (sonnet)
- [WARNING] a refused leave with an unusable bundle lost the policy --> FIXED (restore first, then take the answer's).
- [WARNING] the settled join skipped the other-company check --> FIXED (one takePolicy for every path).

#### Iteration 5 (opus)
- [WARNING] an unsigned policy: null lifted the policy --> FIXED (null never lifts; the coordinator has no delete).
- [WARNING] restore comment claimed a re-check that does not happen --> FIXED.
- [WARNING] pending leave retried after a restart --> DECIDED (plan). [WARNING] no server join test --> DECIDED (plan).
- [NIT] a waiting bundle of another company --> FIXED. [NIT] shadowed res --> FIXED.

#### Iteration 6 (sonnet)
- [WARNING] join window over 5 s --> duplicate of the documented trade-off. [WARNING] unconfirmed leave --> duplicate of the decision.
- [WARNING] refusals never shown --> DEFERRED to the next slice (reporting the applied version).
- [NIT] misplaced doc block, unguarded org, marks comment, expired-bundle test --> FIXED.

#### Iteration 7 (opus)
- [WARNING] unconfirmed leave lifts the policy --> duplicate of the decision; the comment now says it plainly.
- [NIT] not-saved refresh skipped the other-company check --> FIXED. [NIT] oversize bundle returned null --> FIXED.
- [NIT] clear() filesystem failure paths, version meaning on refusals, real create path untested --> accepted.
