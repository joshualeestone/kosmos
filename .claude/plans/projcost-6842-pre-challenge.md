---
pre_challenge: true
method: challenge-loop
branch: projcost-6842
diff_hash: 2026a2ed751ebca4df2fea6aec7aba9eee0b492e1b3226d208a6ae2944615fcf
validation: passed
subdir_audit: passed
timestamp: 2026-10-22T09:41:36Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7
**Converged:** Yes
**Total findings:** 19 in the ledger (18 WARNINGs, 1 CONVENTION), plus the NITs listed below
**Fixed:** 16 | **Deferred:** 3 | **Asked (awaiting user):** 0

**Validation, stated:** the full validation on the final head 41d67ca7e3 passed: 23067 tests, 0 failed (313 skipped),
with type-check, lint-fix, the shell suite and build; hash 2026a2ed751e matches this proof. An earlier run on
e761801f8b failed twice: `server.phonenotify-718` (the #6488 load flake, 49/49 alone) and `tools.shell-shard-4317`,
which was real for this branch: the browser-check surface gate refused, because the new "may not record pull
requests" line in the project cost block uses the `tkr-line` token that `render-task-receipt-prs-6842.js` is mapped to.
That check draws only a task receipt, so the line is outside it; run on this branch through queued-heavy it passes.
The fix is the per-check trailer in the empty commit 41d67ca7e3 (the surface gate then answered rc=0, and rc=1 before).
41d67ca7e3 changes no file, so the reviewed diff is unchanged.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0
- [WARNING] the plan claimed an "estimated" label the page lacked --> FIXED ef912b3cc8 (the page says what overlaps)
- [WARNING] prsMore summed across agents --> FIXED ef912b3cc8 ("up to")
- [WARNING] tasks vs picked; every task unread printed 0 --> FIXED ef912b3cc8 (picked; an explicit sentence; mutant)
- [WARNING] a PR keyed by url or number split one PR in two --> FIXED ef912b3cc8 (repo#number; mutant)
- [CONVENTION] the cost derivation was duplicated --> FIXED ef912b3cc8 (tkTokensAndCost shared; structural test)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 4 NITs
**Self-generated:** 0
- [WARNING] the overlap line showed on every project --> FIXED 2ee1874135 (shared agents only)
- [WARNING] unread agents were not in prsUnknown --> FIXED 2ee1874135 (mutant)
- [WARNING] no coalescing per project --> FIXED 2ee1874135 (an in-flight read is shared; mutant)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 4 NITs
**Self-generated:** 1 (iteration 2's shared-agent rule)
- [WARNING] a shared agent is necessary but not sufficient for overlap --> FIXED 08e82bed17 (overlap from the holds; mutant)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 4 NITs
**Self-generated:** 1 (the overlap rule)
- [WARNING] an unreadable agent fed overlapping --> FIXED 2ad41a8de0 (test)
- [WARNING] inclusive bounds --> FIXED 2ad41a8de0 (strict; mutant)
- [WARNING] "reads high" with nothing readable --> FIXED 2ad41a8de0 (test)
- [WARNING] the PR line vanishes with prsMore above 0 and no names --> DEFERRED: unreachable (more only past 20 named; names survive the merge)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 4 NITs
**Self-generated:** 1 (the wording)
- [WARNING] "is higher" overclaimed --> FIXED cd977fc910 ("may be higher"; test with an overlap)
- [WARNING] no cache across paints --> DEFERRED: a repeat of iteration 2 W3 and the plan's weakest premise

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 3 NITs
**Self-generated:** 1 (the unreadOnly rule)
- [WARNING] unreadOnly fired with readable tasks that had no activity --> FIXED e761801f8b (readable; mutant)
- [WARNING] receipts without holds read as no overlap --> FIXED as a comment (every receipt since the file's first commit carries holds)
- [WARNING] strict versus inclusive inHold --> FIXED e761801f8b (the comment softened)
- [WARNING] the route's cost and its auth gate --> DEFERRED: a repeat of the weakest premise; the gate verified (agent-token refusal, route test)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
**Converged** - no new actionable findings. The NITs were left unfixed so the reviewed bytes are the shipped bytes.

### Final Ledger

| # | Iter | Category | Origin | Description | Status | Resolution |
|---|------|----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | BRANCH | "estimated" label absent | FIXED | ef912b3cc8 |
| 2 | 1 | WARNING | BRANCH | prsMore summed | FIXED | ef912b3cc8 |
| 3 | 1 | WARNING | BRANCH | tasks vs picked | FIXED | ef912b3cc8 |
| 4 | 1 | WARNING | BRANCH | PR key split | FIXED | ef912b3cc8 |
| 5 | 1 | CONVENTION | BRANCH | duplicated derivation | FIXED | ef912b3cc8 |
| 6 | 2 | WARNING | BRANCH | overlap on every project | FIXED | 2ee1874135 |
| 7 | 2 | WARNING | BRANCH | unread agents uncounted | FIXED | 2ee1874135 |
| 8 | 2 | WARNING | BRANCH | no coalescing | FIXED | 2ee1874135 |
| 9 | 3 | WARNING | SELF | shared agent not sufficient | FIXED | 08e82bed17 |
| 10 | 4 | WARNING | SELF | unreadable agent in overlap | FIXED | 2ad41a8de0 |
| 11 | 4 | WARNING | SELF | inclusive bounds | FIXED | 2ad41a8de0 |
| 12 | 4 | WARNING | BRANCH | reads high with nothing readable | FIXED | 2ad41a8de0 |
| 13 | 4 | WARNING | BRANCH | PR line vanishes | DEFERRED | unreachable |
| 14 | 5 | WARNING | SELF | "is higher" | FIXED | cd977fc910 |
| 15 | 5 | WARNING | BRANCH | no cache across paints | DEFERRED | dup, weakest premise |
| 16 | 6 | WARNING | SELF | unreadOnly with readable tasks | FIXED | e761801f8b |
| 17 | 6 | WARNING | BRANCH | receipts without holds | FIXED | comment |
| 18 | 6 | WARNING | BRANCH | strict vs inclusive | FIXED | e761801f8b |
| 19 | 6 | WARNING | BRANCH | route cost and auth | DEFERRED | dup, gate verified |


### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- the combined caveat wording, a stale picked-fallback comment, a long doc line, the page-local name `unread` (iteration 7)
- the dropped numberless PR (iteration 2, pinned by a test)
- the aria-live repaint (iteration 3, the plan's premise)
- a refetch per repaint (iteration 1, bounded by the stale guard)

### Strengths (across all iterations)
- Not reported, none and unknown are kept apart on the page: an unread task never reads as 0
- The overlap caveat is said only when one agent's holds on two counted tasks really overlap
- Each behaviour fix carries a test, most with a mutant that the test fails on
