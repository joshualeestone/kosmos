---
pre_challenge: true
method: challenge-loop
branch: retrygate-6353
diff_hash: 70f4b8e4f51c38253bb444168e0eb91ca2b01a15c65864c10fa9e27daf39d245
validation: passed (Mortals, hash 70f4b8e4f51c; a local run of the same head was red only on the #2518 surface gate, fixed by trailer commit 57aab39a)
subdir_audit: passed
timestamp: 2026-10-17T14:27:23Z
iterations: 11
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 11
**Converged:** Yes (iteration 5, then reopened by the design-shots screen and Mona Lisa's design review; converged again at 11)
**Total findings recorded in this session (iterations 3 to 11):** 18 actionable (0 BLOCKERs, 16 WARNINGs, 2 CONVENTIONs) plus NITs
**Fixed:** 11 | **Deferred:** 7 | **Asked (awaiting user):** 0

Iterations 1 and 2 ran in this agent's previous session, which ended at a context restart before this file was written. Their findings and fixes are in the bodies of commits 7b31cf62 (iteration 1) and 77e9ad80 (iteration 2); all FIXED. Their reviewer models were not recorded.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** unknown (previous session)
**New findings:** see commit 7b31cf62: accepted Try again removes the button at once; every-try-used refusal paints the recovery; no promise of a new code unless one is coming; focus stays in the block; old tunnel worded as unsupported. All FIXED.
**Self-generated:** unknown

#### Iteration 2
**Reviewer model:** unknown (previous session)
**New findings:** see commit 77e9ad80: the page's 10-minute clock reset on needs_retry and on an accepted press; focus fallback to the block; copy fits a computer moved to another approver; arms outlast held rounds. All FIXED.
**Self-generated:** unknown

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 0 acted on as SELF
- [WARNING] server.js:10832 — isViaScreen accepts cross-site --> DEFERRED: crossSiteWrite refuses foreign Origins before every route (server.js:5425)
- [WARNING] web/index.html:51514 — retry branch only while plusJoinLive --> DEFERRED: the tunnel sets needs_retry only while held, which keeps the block live
- [WARNING] web/index.html:51509 — mixed versions dead-end line --> DEFERRED: plan accepts mixed versions; the relay PR is held to merge with this one
- [WARNING] engine/remote.js:2206 — a tunnel with join but no retry worded as unable to pair --> FIXED (4843f67e)
- [CONVENTION] plan exists --> no action

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] docs/browser-checks/render-connect-sheet-4637.js:368 — the old-clock arm could not fail --> FIXED (49968d20, clock aged first)
- [WARNING] web/index.html:51530 — nothing_to_retry brought back a dead button --> FIXED (49968d20)
- [WARNING] web/index.html:51536 — focus pulled back after the person moved it --> FIXED (49968d20, with an arm)

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs new (3 duplicates of iteration 3, confirmed resolved or deferred), 2 NITs
**Self-generated:** 0
**Converged** (first time). Reopened by the design-shots screen (5faf55a0) and Mona Lisa's review follow-ups (3863e5b3: pill "Needs you", "press Try again for a new code").

#### Iteration 6
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0
- [WARNING] web/index.html:51538 — a refusal line stayed under the button indefinitely --> FIXED (22320f77, 10-minute limit)
- [WARNING] web/index.html:51530 — an accepted press promised a code forever while rounds failed --> FIXED (22320f77, 10-minute limit)

#### Iteration 7
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 1 (the pill helper's placement)
- [CONVENTION] web/index.html:51412 — new helper sat between plusJoinLive and its comment --> FIXED (07fc189d)
- [WARNING] web/index.html:51521 — dead end after the promise lapses --> DEFERRED, then FIXED at iteration 8 when raised again
- [WARNING] web/index.html:51499 — old page on a new tunnel --> DEFERRED: plan Known gap, relay PR held to merge together
- [WARNING] web/index.html:51534 — focus onto the live block --> DEFERRED: the earlier WCAG 2.4.3 call
- [WARNING] render-connect-sheet-4637.js:384 — fixed sleeps --> DEFERRED: the file's existing pattern

#### Iteration 8
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1
- [WARNING] web/index.html:51409 — Forget/Off did not clear the two new clocks --> FIXED (e6a45133)
- [WARNING] web/index.html:51521 — "That code ran out." stopped dead --> FIXED (e6a45133, "Kosmos is checking with your other computer.")

#### Iteration 9
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 new WARNINGs (cross-site and mixed versions are duplicates), 1 wording point taken
**Self-generated:** 0
- [WARNING] server.js:10834 — comment called the route screen-only --> FIXED (74241efe, says advisory)

#### Iteration 10
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1
- [WARNING] web/index.html:51535 — a press answered after a reset wrote its timer --> FIXED (4b7073de, generation check)
- [WARNING] web/index.html:51499 — a rebuilding repaint dropped keyboard focus --> FIXED (4b7073de)

#### Iteration 11
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs new (the confirm_expired overwrite holds: plusJoinTick replaces PLUS_JOIN each round), 3 NITs
**Self-generated:** 0
**Converged** — no new actionable findings.

### Final Ledger (iterations 3 to 11)

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 3 | WARNING | server.js:10832 | BRANCH | cross-site on isViaScreen | DEFERRED | crossSiteWrite before every route |
| 2 | 3 | WARNING | web/index.html:51514 | BRANCH | retry only while live | DEFERRED | needs_retry implies held |
| 3 | 3 | WARNING | web/index.html:51509 | BRANCH | mixed versions | DEFERRED | relay PR held |
| 4 | 3 | WARNING | engine/remote.js:2206 | BRANCH | old tunnel wording | FIXED | 4843f67e |
| 5 | 4 | WARNING | render-connect-sheet-4637.js:368 | BRANCH | arm could not fail | FIXED | 49968d20 |
| 6 | 4 | WARNING | web/index.html:51530 | BRANCH | dead button on nothing_to_retry | FIXED | 49968d20 |
| 7 | 4 | WARNING | web/index.html:51536 | BRANCH | focus pulled back | FIXED | 49968d20 |
| 8 | 6 | WARNING | web/index.html:51538 | BRANCH | refusal line forever | FIXED | 22320f77 |
| 9 | 6 | WARNING | web/index.html:51530 | BRANCH | promise forever | FIXED | 22320f77 |
| 10 | 7 | CONVENTION | web/index.html:51412 | SELF | helper placement | FIXED | 07fc189d |
| 11 | 7 | WARNING | web/index.html:51534 | BRANCH | focus on live block | DEFERRED | WCAG 2.4.3 call |
| 12 | 7 | WARNING | render-connect-sheet-4637.js:384 | BRANCH | fixed sleeps | DEFERRED | file pattern |
| 13 | 8 | WARNING | web/index.html:51409 | SELF | reset kept clocks | FIXED | e6a45133 |
| 14 | 8 | WARNING | web/index.html:51521 | SELF | dead-end sentence | FIXED | e6a45133 |
| 15 | 9 | WARNING | server.js:10834 | BRANCH | screen-only wording | FIXED | 74241efe |
| 16 | 10 | WARNING | web/index.html:51535 | SELF | press after reset | FIXED | 4b7073de |
| 17 | 10 | WARNING | web/index.html:51499 | SELF | repaint dropped focus | FIXED | 4b7073de |
| 18 | 7 | WARNING | web/index.html:51499 | BRANCH | old page on new tunnel | DEFERRED | plan Known gap |

### NITs (non-blocking, across all iterations)
- [NIT] joinUnsupported widened for every caller (iterations 3, 6, 8, 9, 10)
- [NIT] tabindex -1 on the live block and screen-reader double read (iterations 3, 6, 8, 10)
- [NIT] two click listeners on #plus-join (iterations 3, 5)
- [NIT] "Needs you" pill could have its own colour state (iteration 8; a design call)

### Strengths (across all iterations)
- The new route matches join/confirm: advisory screen check, global cross-site guard, fixed argv with no request input, a control proving the 403 comes from the guard (iterations 3 to 11)
- Refusals are mapped to tags, so no tunnel stderr reaches the page; old and very old tunnels are worded apart (iterations 4, 6, 11)
- Browser-check arms can fail on each fix, and both runs on 4b7073de passed all page checks (iterations 6 to 11)
