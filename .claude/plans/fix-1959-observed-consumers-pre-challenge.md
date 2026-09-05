---
pre_challenge: true
method: challenge-loop
branch: fix-1959-observed-consumers
diff_hash: c84baae55f13783fba74c89619c2bac92f839a665c79e76b150cf76f2468f6db
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T08:18:19Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 (6.0 baseline + 4 blind review passes)
**Converged:** Yes (iteration 5 found zero new BLOCKER/WARNING/CONVENTION; two non-blocking plan NITs, fixed)
**Total findings:** 1 BLOCKER-adjacent scope gap (folded in), 3 WARNINGs, 1 CONVENTION, several NITs
**Fixed:** all actionable | **Deferred:** the cross-layer consumers (computeMachine, account-status route, OpenAI-only pickers), documented on the card

The change: extend the #1921 observed-liveness badge (`connection.badge`) to the three
/api/accounts-fed consumers (paintConnLive summary, paintAccountPicker move eligibility,
fillCreateAccounts create picker) via three shared frontend helpers, so a `rejected` credential
(#874) no longer reads "connected"/offered. web/index.html + a hermetic browser-check + existing-test
updates + docs; NO server.js (no collision with the active whoami PR #2218). Validation PASSED on the
clean tree (hash 33a200900fad); browser-check 24/24 chromium+webkit, each discriminating arm proven
RED on the pre-fix page.

### Per-Iteration Breakdown

#### Iteration 1 (6.0 baseline)
Clean (the box was held by release cuts through much of the run; the clean-tree suite validated at
33a200900fad once the box freed).

#### Iteration 2 (blind review 1)
**New:** 1 WARNING -> FIXED. A THIRD /api/accounts-fed consumer, `fillCreateAccounts` (the create-agent
account picker, the card's named "account picker"), still read raw state and offered a `rejected`
account as a run target (the new agent could not run). Folded in via a third helper
`acctOfferableTarget` (exclude confirmed-unusable rejected/signed_out, keep include-and-label for
uncertain); a browser-check arm added (commit 67f9c7f8). Two NITs deferred (box-every-phase-style; the
"signed out" wording is the documented weakest premise).

#### Iteration 3 (blind review 2)
**New:** 1 WARNING (stale "16/16" count) + 1 CONVENTION ("three arms" omitting arm 4) -> FIXED in the
check header, README, driver comment, and plan (commit ab6e4098).

#### Iteration 4 (blind review 3)
**New:** 1 WARNING -> FIXED. The docs claimed the helper-matrix arm exercised `acctOfferableTarget`,
but arm 1 only called the other two helpers, leaving acctOfferableTarget's signed_out branch and
badge-less fallback unguarded. Added acctOfferableTarget to the matrix arm. ALSO: running the full
node --test suite (the "run the existing suite first" lesson) surfaced regressions the browser-check
could not - five existing test files eval or source-pin the consumer functions and asserted the OLD
raw-state reads: ReferenceError in the two eval-style tests (helpers not in scope) and stale
source-pin assertions in three others. Fixed all five (commit abbc228e): eval tests slice the REAL
helpers into scope (no drift); source-pin tests updated to assert the new helper usage, intent
preserved. Browser-check now 24/24; counts/arm-count corrected. One NIT (plan count) deferred to iter 5.

#### Iteration 5 (blind review 4)
**New:** 0 BLOCKER/WARNING/CONVENTION -> CONVERGED. The reviewer specifically vetted that the five
test updates still test something real (not weakened to pass): the eval tests slice real helpers, the
source-pins would red if a helper call were removed (web.accounts-add pins the exact
`!acctUsableLogin(acctLive)` negation), and the browser-check arms are genuine discriminators. It also
independently traced every remaining raw-state site and confirmed no /api/accounts-fed Claude-row
consumer was missed. Two non-blocking plan NITs (stale "two helpers" heading; deferral list could name
fillSwitchAccounts) fixed on convergence (commit after this proof's base).

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 2 | WARNING | web/index.html fillCreateAccounts | third /api/accounts-fed consumer offered a rejected run target (#874) | FIXED | 67f9c7f8 (acctOfferableTarget) |
| 2 | 3 | WARNING | README/plan | stale "16/16" verification count | FIXED | ab6e4098 |
| 3 | 3 | CONVENTION | check/README/driver | "three arms" omitted arm 4 | FIXED | ab6e4098 |
| 4 | 4 | WARNING | render-observed-consumers-1959.js | matrix arm did not cover acctOfferableTarget (docs overstated) | FIXED | abbc228e |
| 5 | 4 | WARNING | 5 test files | existing tests broke (ReferenceError + stale source-pins) on the shared-helper switch | FIXED | abbc228e |
| 6 | 5 | NIT | plan | "two helpers" heading (three now); deferral could name fillSwitchAccounts | FIXED | plan commit |

### NITs (non-blocking, deferred with reasoning)
- The move-eligibility (paintAccountPicker) still treats an `unchecked` current account as signedOut ("signed out" message). Pre-existing (pre-fix `state !== 'connected'` already did), UNCHANGED by this PR, not a regression; distinguishing it is a message-design addition left for the browser-capable follow-up. Documented in the plan.
- The "signed out" wording for a `rejected` account is imprecise (technically signed in, token rejected); the remedy text is correct. The plan owns this as the coarse, reversible trade-off.

### Strengths (across iterations)
- The two-derivations anti-pattern is avoided: three shared hoisted helpers are the single source all three consumers decide from, badge-first with the legacy `.state` fallback, mirroring #1921's paintAccounts.
- Scope is honest and complete: every remaining raw-state site was traced and classified (paintAccounts fallback, OpenAI-only pickers, first-run) - no Claude-row consumer missed. Deferrals reasoned.
- The browser-check is hermetic and non-vacuous; the test updates preserve intent (verified by the convergence reviewer), not weakened to pass.
