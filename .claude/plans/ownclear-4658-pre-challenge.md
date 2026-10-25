---
pre_challenge: true
method: challenge-loop
branch: ownclear-4658
diff_hash: 903e9d134b584314b46ac932cb8aa4ce772fe7e5cf1c68be616ec1b880b6136a
validation: passed (Mortals)
subdir_audit: passed
timestamp: 2026-10-25T14:08:57Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10 (opus and sonnet alternating)
**Converged:** Yes (iteration 10: its three WARNINGs deduplicated against earlier deferrals or answered by an existing test)
**Total findings:** 29 actionable (1 BLOCKER, 26 WARNINGs, 2 final-validation BLOCKERs) plus NITs
**Fixed:** 22 | **Deferred:** 7 | **Asked (awaiting user):** 0

Validation: full suite on Mortals at 4a1358fb57 (hash 980ac626972d), status clean: 23898 tests, 23564 pass, 0 fail
(the rest skipped). The run before it (55c18544b9) failed 3 tests in server.ownallow-4658.test.js (a reworded refusal,
own-compare now answering pending): fixed in 4a1358fb57. 6j: skipped on the clean entry, worktree clean. Browser
checks render-ownseal-4658, render-ownremove-4658, render-federation-invite-4649 PASS frozen at 4a1358fb57. Mutants,
each committed first and restored with git checkout, every one red: clear from any owner key (with a run-bound forgery),
a clear accepted after a seal, no pending hold, refusing unsealed messages while waiting, accepting v1, a silent clear
owner, no adopt at confirm, a sealed envelope flipping a waiting computer, a share keeping pending, the old write order,
no retry at connect, the run-reset BLOCKER guard, noteOwnSealed sealing unproven rooms, the letIn mark, the eligibility
rule, the resend, the resend gate (keyed), the AAD without nonces, the AAD and field without mac, the migration.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, NITs
**Self-generated:** 0
- [WARNING] engine/fedseats.js noteOwnSealed — one unauthenticated sealed envelope locked a waiting computer out for good --> FIXED (e546273736: only the owner's share or clear decides)
- [WARNING] engine/fedseats.js — an older owner never answers a v3 joiner, silently --> FIXED (waiting note; NOT CLAIMED)
- [WARNING] engine/fedseats.js adoptOwnShare — kept pendingClear on record and link --> FIXED (e546273736)
- [WARNING] engine/fedseats.js adoptOwnClear — forgot the record before the link; said let in early --> FIXED (e546273736: link first, retry at connect)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, NITs
**Self-generated:** 1 (iteration 1's noteOwnSealed link write)
- [WARNING] unsealed messages shown while waiting are unauthenticated --> FIXED (plan, NOT CLAIMED)
- [WARNING] a v3 code from a self computer needs the first computer to answer --> FIXED (plan, intended)
- [WARNING] noteOwnSealed wrote a lasting seal on an old computer's link --> FIXED (d81d8cd5f7: removed; test; mutant red)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 4 WARNINGs, NITs
**Self-generated:** 0
- [BLOCKER] engine/fedseats.js waitingOffer — a re-offer after Allow reset a run holding a clear --> FIXED (bd67076fcd: run.gotClear kept; test delivers the re-offer; mutant red)
- [WARNING] noteOwnSealed sealed any unproven room for good --> FIXED (pendingClear record unless the link says sealed)
- [WARNING] a failed clear write was silent --> FIXED (note; plan qualifies the retry)
- [WARNING] the owner sealing between Allow and confirm --> DEFERRED: cannot happen while the self-shared refusal stands (plan)
- [WARNING] clear-admitted computers are not listed --> DEFERRED: nothing to take back (plan)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, NITs
**Self-generated:** 1 (iteration 3's pendingClear in noteOwnSealed)
- [WARNING] a forged envelope put a let-in computer back into waiting --> FIXED (e5b57e86d7: letIn mark)
- [WARNING] agents read unauthenticated rows while waiting --> FIXED (plan, NOT CLAIMED)
- [WARNING] guests could fill the waiting list --> DEFERRED: not reachable, key-own-* needs the relay's same_account stamp
- [WARNING] a refused clear was silent --> FIXED (note)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, NITs
**Self-generated:** 1 (iteration 4's unreachable note)
- [WARNING] older keyless records could never take a clear; the refused note never fired --> FIXED (3e8df4c0aa: clearEligible; tests both ways)
- [WARNING] a relay flooding hellos uses the owner's run budget --> FIXED (plan, NOT CLAIMED)
- [WARNING] the v3 join note decided sealing from the code --> FIXED (reworded)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, NITs
**Self-generated:** 0
- [WARNING] a pre-slice computer put into waiting by one envelope --> DEFERRED: recoverable, stated in the plan
- [WARNING] repeated hellos after Allow spent the owner's run budget --> FIXED (d1567728d2: the same clear is resent)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, NITs
**Self-generated:** 1 (iteration 6's resend)
- [WARNING] the resend did not re-check the room still reads clear --> FIXED (5a47fd24d0, 71fd2d63ed: gate, keyed test, mutant red)
- [WARNING] no unit test pinned the clear's bindings --> FIXED (fedseal test, genuine control plus five replays)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, NITs
**Self-generated:** 0
- [WARNING] nothing ties letIn to the self-shared refusal --> FIXED (886182bb04: comment at the refusal)
- [WARNING] the resend was not caught like the offer --> FIXED
- [WARNING] a forged envelope flips a pre-slice computer into waiting --> DEFERRED: duplicate of iteration 6

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, NITs
**Self-generated:** 1 (iteration 5's clearEligible surfaces)
- [WARNING] an older keyless record was "waiting" on screen and "sealed" underneath --> FIXED (55c18544b9: read as waiting at connect)
- [WARNING] two binding cases were stopped by field compares, not the seal --> FIXED (forgeries with the fields rewritten; mutant red)

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs (all deferred), NITs
**Self-generated:** 0
- [WARNING] the pre-slice stuck state --> DEFERRED: duplicate of iterations 6 and 8 (NOT CLAIMED)
- [WARNING] an owner restart loses the clear cache --> DEFERRED: duplicate of iteration 9's plan line
- [WARNING] letIn rests on a comment --> DEFERRED: the guard exists, federation-owncode test "an invite is refused for a project shared with this account's other computers"
**Converged** — no new actionable findings.

#### Final validation (6j)
- [BLOCKER] final-validation: server.ownallow-4658.test.js (3 stale expectations) --> FIXED (4a1358fb57)
- [BLOCKER] final-validation (PR CI browser-checks, after a rebase onto main fd0cb1b154): render-federation-invite-4649 B15g set the next member list after pressing Remove, a race in the check (its sibling B11 sets it first) --> FIXED (0690b7d117; check rerun locally)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/fedseats.js noteOwnSealed | BRANCH | envelope locks a waiting computer | FIXED | e546273736 |
| 2 | 1 | WARNING | engine/fedseats.js | BRANCH | older owner never answers | FIXED | e546273736 |
| 3 | 1 | WARNING | engine/fedseats.js adoptOwnShare | BRANCH | pending kept after share | FIXED | e546273736 |
| 4 | 1 | WARNING | engine/fedseats.js adoptOwnClear | BRANCH | write order | FIXED | e546273736 |
| 5 | 2 | WARNING | plan | BRANCH | unauthenticated rows while waiting | FIXED | d81d8cd5f7 |
| 6 | 2 | WARNING | plan | BRANCH | v3 from a self computer | FIXED | d81d8cd5f7 |
| 7 | 2 | WARNING | engine/fedseats.js noteOwnSealed | SELF | lasting seal on an old link | FIXED | d81d8cd5f7 |
| 8 | 3 | BLOCKER | engine/fedseats.js waitingOffer | BRANCH | re-offer resets a clear run | FIXED | bd67076fcd |
| 9 | 3 | WARNING | engine/fedseats.js noteOwnSealed | BRANCH | unproven room sealed for good | FIXED | bd67076fcd |
| 10 | 3 | WARNING | engine/fedseats.js adoptOwnClear | BRANCH | silent failed write | FIXED | bd67076fcd |
| 11 | 3 | WARNING | engine/fedseats.js allowOwn | BRANCH | owner seals between Allow and confirm | DEFERRED | refusal stands |
| 12 | 3 | WARNING | engine/fedseats.js allowOwn | BRANCH | clear-admitted not listed | DEFERRED | nothing to take back |
| 13 | 4 | WARNING | engine/fedseats.js noteOwnSealed | SELF | let-in computer back into waiting | FIXED | e5b57e86d7 |
| 14 | 4 | WARNING | plan | BRANCH | agents read unverified rows | FIXED | e5b57e86d7 |
| 15 | 4 | WARNING | engine/fedseats.js ownerOwnHello | BRANCH | guests fill the waiting list | DEFERRED | same_account gate |
| 16 | 4 | WARNING | engine/fedseats.js adoptOwnClear | BRANCH | silent refused clear | FIXED | e5b57e86d7 |
| 17 | 5 | WARNING | engine/fedseats.js waitingClear | SELF | older keyless record never cleared | FIXED | 3e8df4c0aa |
| 18 | 5 | WARNING | plan | BRANCH | hello flood | FIXED | 3e8df4c0aa |
| 19 | 5 | WARNING | server.js join note | BRANCH | note decides sealing from the code | FIXED | 3e8df4c0aa |
| 20 | 6 | WARNING | engine/fedseats.js noteOwnSealed | BRANCH | pre-slice into waiting | DEFERRED | recoverable, stated |
| 21 | 6 | WARNING | engine/fedseats.js ownerOwnHello | BRANCH | repeated hello spends runs | FIXED | d1567728d2 |
| 22 | 7 | WARNING | engine/fedseats.js ownerOwnHello | SELF | resend without re-check | FIXED | 71fd2d63ed |
| 23 | 7 | WARNING | engine/fedseal.test.js | BRANCH | clear bindings untested | FIXED | 5a47fd24d0 |
| 24 | 8 | WARNING | engine/federation.js selfSharedRef | BRANCH | letIn dependency unnamed | FIXED | 886182bb04 |
| 25 | 8 | WARNING | engine/fedseats.js ownerOwnHello | SELF | resend not caught | FIXED | 886182bb04 |
| 26 | 9 | WARNING | engine/fedseats.js sayHello | SELF | one record, two readings | FIXED | 55c18544b9 |
| 27 | 9 | WARNING | engine/fedseal.test.js | BRANCH | field compares mask the seal | FIXED | 55c18544b9 |
| 28 | 6j | BLOCKER | server.ownallow-4658.test.js | BRANCH | final-validation: stale expectations | FIXED | 4a1358fb57 |
| 29 | 6j | BLOCKER | docs/browser-checks/render-federation-invite-4649.js:1544 | PRE-EXISTING | final-validation: B15g ordering race | FIXED | 0690b7d117 |

### NITs (non-blocking, across all iterations)
- [NIT] the phone line and the confirmed card are not asserted by the browser check (iterations 5, 10)
- [NIT] an older Kosmos reads a v3 code as "not recognised" rather than "update Kosmos" (iteration 10)
- [NIT] ownCodeRefusal's record arm also covers half-written adoptions (iteration 10)

### Strengths (across all iterations)
- key-own-clear is bound like key-own-share (own pair-key label, AAD over room, computer and both nonces) and opens only under the confirmed owner key (every iteration)
- the downgrade paths fail closed: v1 refused at verify, v2 and v3 held until an authenticated answer, a share beats a clear (iterations 2 to 10)
- write ordering and recovery in adoptOwnClear; a run holding a clear survives re-offers; the resend spends no run (iterations 4 to 10)
