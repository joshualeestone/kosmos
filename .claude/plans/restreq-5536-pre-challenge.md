---
pre_challenge: true
method: challenge-loop
branch: restreq-5536
diff_hash: 198a422a315296875cfe487bb58c1734126579e49a48d6926a046f634854f9aa
validation: passed (Mortals, entry clean, 16862 tests, 0 fail)
subdir_audit: passed
timestamp: 2026-10-08T15:32:06Z
iterations: 19
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 19
**Converged:** Yes (iteration 19 returned one warning, a duplicate of a concern already in the contract: one person holding both an admin device and the contact's device; no new BLOCKER, WARNING or CONVENTION)
**Total findings:** every round 1 to 18 found at least one actionable issue; the plan records them as prose paragraphs per round, not per-finding categories, so this proof does not invent category counts. Each round's MAIN finding is listed below as [WARNING] (my reading: each was WARNING or higher); the "Also:" items in each paragraph were smaller fixes.
**Fixed:** all actionable findings in rounds 1 to 18 | **Deferred:** round 10 (a lower bound on seenAt, already enforced and tested), round 16 (noticeSentAt truthfulness, a repeat of round 15, caller contract) | **Asked:** 0
**Validation:** full suite on Mortals for this exact diff hash: entry clean, 16862 tests, 0 fail. The branch was squashed from 21 commits to one (same tree, checked) and rebased onto main before validation; the only conflict (engine.reachable.test.js) resolves to main's file plus this branch's three entries, diffed.
**Reviewer models:** opus on odd iterations, sonnet on even.

### Per-Iteration Breakdown
#### Iteration 1
**Reviewer model:** opus
- [WARNING] engine/restorerequest.js - the two-person rule compared ids, not keys (two ids on one key passed --> FIXED (see the round's paragraph in .claude/plans/restreq-5536.md and the commit "restreq-5536 -- address challenge-loop iteration 1 findings")

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] engine/restorerequest.js - nothing tied the destination to the member (now a required destinationAllowed(fingerprint, member), so two admins cannot name a key of their own) --> FIXED (see the round's paragraph in .claude/plans/restreq-5536.md and the commit "restreq-5536 -- address challenge-loop iteration 2 findings")

#### Iteration 3
**Reviewer model:** opus
- [WARNING] engine/restorerequest.js - a pair of signatures held for a year still released (now refused once first seen more than an hour after its waitEndsAt) --> FIXED (see the round's paragraph in .claude/plans/restreq-5536.md and the commit "restreq-5536 -- address challenge-loop iteration 3 findings")

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] engine/restorerequest.js - the service's callbacks failed open (a Promise from destinationAllowed read as allowed --> FIXED (see the round's paragraph in .claude/plans/restreq-5536.md and the commit "restreq-5536 -- address challenge-loop iteration 4 findings")

#### Iteration 5
**Reviewer model:** opus
- [WARNING] engine/restorerequest.js - recordSeen trusted its store (a Promise or a string overwrote the first sight, pushing the wait forward on every relay --> FIXED (see the round's paragraph in .claude/plans/restreq-5536.md and the commit "restreq-5536 -- address challenge-loop iteration 5 findings")

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] engine/restorerequest.js - checkRelease took seenAt as a bare number, so nothing forced the recorded first sight (and its member notice) to exist (now it takes the seen store, reads it by requestId and refuses a request never recorded) --> FIXED (see the round's paragraph in .claude/plans/restreq-5536.md and the commit "restreq-5536 -- address challenge-loop iteration 6 findings")

#### Iteration 7
**Reviewer model:** opus
- [WARNING] engine/restorerequest.js - the release result left out breakGlass and the signer ids, so a caller counting break-glass or writing the audit trail had to re-read the unvalidated input (now returned from the verified copy) --> FIXED (see the round's paragraph in .claude/plans/restreq-5536.md and the commit "restreq-5536 -- address challenge-loop iteration 7 findings")

#### Iteration 8
**Reviewer model:** sonnet
- [WARNING] engine/restorerequest.js - three caller-contract gaps, now stated in the header: re-read cancellation and consume the nonce in one atomic step at release --> FIXED (see the round's paragraph in .claude/plans/restreq-5536.md and the commit "restreq-5536 -- address challenge-loop iteration 8 findings")

#### Iteration 9
**Reviewer model:** opus
- [WARNING] engine/restorerequest.js - cancellations were missing from the retention rule (a purged cancellation reads as none --> FIXED (see the round's paragraph in .claude/plans/restreq-5536.md and the commit "restreq-5536 -- address challenge-loop iteration 9 findings")

#### Iteration 10
**Reviewer model:** sonnet
- [WARNING] engine/restorerequest.js - recordSeen recorded a request already cancelled, so the member got an alarm for a dead request (now it takes isCancelled and refuses). Deferred, already enforced: a lower bound on seenAt (timeProblem's first line is that bound,... --> FIXED (see the round's paragraph in .claude/plans/restreq-5536.md and the commit "restreq-5536 -- address challenge-loop iteration 10 findings")

#### Iteration 11
**Reviewer model:** opus
- [WARNING] engine/restorerequest.js - the break-glass contact could be inherited from a polluted Object.prototype, checked but left out of the signed bytes (round 10 fixed only the ordinary half --> FIXED (see the round's paragraph in .claude/plans/restreq-5536.md and the commit "restreq-5536 -- address challenge-loop iteration 11 findings")

#### Iteration 12
**Reviewer model:** sonnet
- [WARNING] engine/restorerequest.js - the header still said a backwards clock throws (my round 9 change made it a refusal --> FIXED (see the round's paragraph in .claude/plans/restreq-5536.md and the commit "restreq-5536 -- address challenge-loop iteration 12 findings")

#### Iteration 13
**Reviewer model:** opus
- [WARNING] engine/restorerequest.js - a crash between first sight and the member notice released silently, and the doc claimed the notice could not be skipped (now a required noticeSent(requestId) must be exactly true, so a lost notice delays the release --> FIXED (see the round's paragraph in .claude/plans/restreq-5536.md and the commit "restreq-5536 -- address challenge-loop iteration 13 findings")

#### Iteration 14
**Reviewer model:** sonnet
- [WARNING] engine/restorerequest.js - noticeSent was a bare boolean, so a notice sent at the end of the wait left the member no time (now noticeSentAt returns the time and the wait runs from the later of first sight and notice --> FIXED (see the round's paragraph in .claude/plans/restreq-5536.md and the commit "restreq-5536 -- address challenge-loop iteration 14 findings")

#### Iteration 15
**Reviewer model:** opus
- [WARNING] engine/restorerequest.js - two caller-contract claims were wider than the module gives (now narrowed: offboarded status must come from the service's own records, and the destination trust list must not be writable by the signing admins). The request-id t... --> FIXED (see the round's paragraph in .claude/plans/restreq-5536.md and the commit "restreq-5536 -- address challenge-loop iteration 15 findings")

#### Iteration 16
**Reviewer model:** sonnet
- [WARNING] engine/restorerequest.js - a break-glass contact who was also a rostered admin was accepted, so three admins could break glass (now refused by id or key, per design v2.1: a third person, not a third admin). Deferred, a repeat of round 15: noticeSentAt's ... --> FIXED (see the round's paragraph in .claude/plans/restreq-5536.md and the commit "restreq-5536 -- address challenge-loop iteration 16 findings")

#### Iteration 17
**Reviewer model:** opus
- [WARNING] engine/restorerequest.js - the contact-versus-admin key filter did not skip non-key roster entries (equals threw) --> FIXED (see the round's paragraph in .claude/plans/restreq-5536.md and the commit "restreq-5536 -- address challenge-loop iteration 17 findings")

#### Iteration 18
**Reviewer model:** sonnet
- [WARNING] engine/restorerequest.js - the wait policy was not named as something the signing admins must not be able to write (now it is: service-owned config) --> FIXED (see the round's paragraph in .claude/plans/restreq-5536.md and the commit "restreq-5536 -- address challenge-loop iteration 18 findings")

#### Iteration 19
**Reviewer model:** opus
**New findings:** 0 (one duplicate warning, deduplicated)
**Converged** - no new actionable findings.

### Final Ledger
| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 10 | WARNING | engine/restorerequest.js | BRANCH | lower bound on seenAt | DEFERRED | already enforced by timeProblem, tested |
| 2 | 16 | WARNING | engine/restorerequest.js | SELF | noticeSentAt truthfulness | DEFERRED | repeat of round 15; caller contract |
| 3 | 19 | WARNING | engine/restorerequest.js | BRANCH | one person, admin + contact devices | DEFERRED | duplicate; already in the contract |

### Strengths
- Canonical bytes with a domain tag, two-admin key check by key not id, a third non-admin contact for break glass, atomic first sight, notice-anchored wait, bounded retention; each rule has a test.
