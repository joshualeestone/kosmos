---
pre_challenge: true
method: challenge-loop
branch: teamprov-4719
diff_hash: ac55398196ebe54227b6aa4c1ca8790890e92dcabfdda05670a9a1141adf0c8b
validation: passed
subdir_audit: passed
timestamp: 2026-10-01T13:06:09Z
iterations: 14
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 14 (11 before the rebase onto main after #4709 merged, 3 after it)
**Converged:** Yes, twice. Iteration 11 (NITs only) on the stacked branch; after the rebase, review 3 (opus,
fresh) returned NO NEW FINDINGS.
**Fixed:** every BLOCKER, MAJOR and WARNING raised (per round below). **Deferred / accepted:** the up-to-5 s
blank wait while accounts load (matches the single-agent form); `maybeMade` keeping the choice locked after a
lost create (iteration 9, #4557's adoption logic); NITs recorded in the plan. **Asked (awaiting user):** 0.

Severity counts for iterations 1 to 11 were recorded in the plan as change lists, not tallied; the per-round
lines below are taken from .claude/plans/teamprov-4719.md, which carries the full text.

Final validation: full suite on Agent1s at dc6e59cd5, 13683 tests, 0 failed, validation_rc=0, recorded PASSED
for hash ac55398196eb (log ~/.cache/claude-handoffs/detached/teamprov-4719-full2.log). The run before it, at
4feac4883, passed every test and stopped on the browser-check surface gate (token `create-account-row`,
render-create-form.js), answered with a per-check trailer in dc6e59cd5 (gate passes alone, GATE_RC=0). PR CI
selects both render-create-form and render-teamcreate-4557, so both run against this change there.

### Per-Iteration Breakdown

#### Iteration 1
- [WARNING] Meta Muse offered on the team step; a copied unusable choice fell back late --> FIXED
- [WARNING] tcFillProvider ignored a newer team opened during its account read --> FIXED (generation check)
- [WARNING] a failed account read did not mark CREATE_ACCOUNTS_FAILED --> FIXED
- [WARNING] the choice was not fixed at the click --> FIXED (TC.model, menus locked; refusal arm in the browser check)
- [NIT] menus do not refresh on a later account change; #3081 last-used provider not applied --> recorded

#### Iteration 2
- [WARNING] copied options carried the Swarm gating --> FIXED (undone from the gate's saved state)
- [WARNING] the step's /api/accounts read was unbounded --> FIXED (5 s)
- [WARNING] refusal arm did not see the lock before asserting it opened --> FIXED
- [NIT] plain select shows a greyed option's reason as text only --> recorded

#### Iteration 3
- [WARNING] a read slower than 5 s was abandoned (OpenAI-only machine left on Claude) --> FIXED (late answer applied; 8 s arm)
- [WARNING] a Muse answer that disables Meta did not settle the team menu --> FIXED (tcProviderSettle)

#### Iteration 4
- [BLOCKER] tcProviderSettle looped /api/muse forever on every board with Muse on (introduced in iteration 3) --> FIXED (acts only on an open, filled, unstarted step; re-entry guard; web.teamprov-settle-4719.test.js)
- [WARNING] a late list replaced a choice copied from the form --> FIXED

#### Iteration 5
- [WARNING] a late list left a copied choice with an empty account menu and greyed Gemini/Grok --> FIXED
- [NIT] shared account globals, last read wins; non-string account dropped --> recorded

#### Iteration 6
- [WARNING] a refused lead locked the menus on the bad choice --> FIXED (fixed only once a member exists; lead-refused arm)
- [WARNING] menus held the last team's options during the wait --> FIXED (disabled)
- [WARNING] the Antigravity answer did not settle the team menu --> FIXED

#### Iteration 7
- [BLOCKER] after a refused first start the menus stayed locked (no repaint) --> FIXED
- [BLOCKER] a Try again run did not count as a run, so a mid-run change could split the team --> FIXED (one rule, tcChoiceFixed, with a 7-case unit test)

#### Iteration 8
- [WARNING] a stale TC.model was used by a Try again run --> FIXED (remembered choice used only once a member exists; test fails with the iteration-7 condition)

#### Iteration 9
- [WARNING] a late list during a click or run was dropped --> FIXED (TC.lateAccounts, applied by tcPaint)
- [WARNING] a non-text provider read as "none" --> FIXED (engine refuses it)
- [WARNING] maybeMade can keep the choice locked after a lost create --> DEFERRED (accepted; #4557's adoption logic)
- [NIT] a disabled selected option can survive Back and reopen --> recorded

#### Iteration 10
- [WARNING] a late list skipped menus the person touched --> FIXED (refilled, their provider and account kept; unit tests)

#### Iteration 11
- No issues found above NIT. Three NITs recorded in the plan. Converged on the stacked branch.

#### Iteration 12 (after the rebase onto main, review 1, opus)
- [BLOCKER] tcProviderSettle read `cstep-team` (the chooser on main), so nothing settled; the unit stub had the same wrong id --> FIXED (dabbd848a; test ties the id to the markup, control 7 pass / 2 fail with the old id)
- [WARNING] no guard against refilling toward an unusable default --> FIXED

#### Iteration 13 (review 2, sonnet)
- [WARNING] menus not disabled through tcFillProvider's 5 s wait --> FIXED (c1253e477, TC_FILLING count)
- [WARNING] settle test read the page relative to cwd --> FIXED (__dirname)
- [WARNING] no route test that provider/account reach each member's spec --> FIXED (server.teamseed-4557.test.js, with control)

#### Iteration 14 (review 3, opus, fresh)
- No issues found. One wording point in the plan (provider rule said "lowercase") reworded in 4feac4883.

### Final Ledger
All BLOCKERs and WARNINGs fixed except the two accepted above; NITs recorded in the plan.
