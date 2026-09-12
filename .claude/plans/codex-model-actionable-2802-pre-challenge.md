---
pre_challenge: true
method: challenge-loop
branch: codex-model-actionable-2802
diff_hash: c8e458d0f2be0344ae9687a5999dbcbcd941a13944cb57cbacfe39453fa7523a
validation: passed
subdir_audit: passed
timestamp: 2026-09-12T02:39:15Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes (iteration 5 surfaced zero NEW actionable findings after dedup)
**Total findings:** 10 (0 BLOCKERs, 6 WARNINGs, 1 CONVENTION, 3 NITs)
**Fixed:** 7 | **Deferred:** 2 | **Asked (awaiting user):** 0

Card #2802: the Codex/ChatGPT-subscription Model tab's disabled selector is made
actionable with a "Connect an API key" button (opens the shared Add-a-provider
modal). The loop hardened the browser-check coverage and one focus regression.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 2 NITs
**Self-generated:** 0 (ITER_COMMITS empty at review time; all findings on branch code)
- [WARNING] render-detail-openai-model-2140.js - coverage gap: `listable.connectHidden` read before the button was ever shown (trivially true), and neither reset (per-paint default-hide, openDetail on-open reset) was armed; removing either kept the check green --> FIXED af5e107a (added the `hideCoverage` block exercising both hide paths, each proven red-capable)
- [CONVENTION] web/index.html:28912 - show predicate re-matches the server `because` prose --> DEFERRED (see ledger #2)
- [NIT] web/index.html:18869 - connect listener not null-guarded --> FIXED af5e107a
- [NIT] web/index.html:18866 - focus a11y (superseded by iter-2 finding #5)

#### Iteration 2
**Reviewer model:** sonnet (different model from iter 1, per 6a rotation)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 (findings on pre-existing closeAcctAdd and the branch-base show gate)
**Duplicates of prior findings:** iter-1 NIT #4 re-raised + escalated as WARNING #5
- [WARNING] web/index.html:18866 - closing the modal from the Model tab strands focus on `<body>` (`#acct-add-open` is display:none outside Settings) - the #1918 stranded-focus class --> FIXED 6bec28b0 (module-level ACCT_ADD_RETURN_FOCUS records the opener; closeAcctAdd returns focus to it with an offsetParent/contains fallback; `connectFocusReturns` assertion added and proven red-capable)
- [WARNING] web/index.html:28912 - the `usable &&` half of the show gate was untested (all fixtures ours+recorded) --> FIXED 6bec28b0 (added `usableGate`: a not-ours agent with the same `because` must keep the button hidden and show the refusal; proven red-capable)
- [NIT] web/index.html:30946 - note prose duplicates the button label --> DEFERRED (plan-accepted tradeoff)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 1 (the connectFocusReturns-vacuity NIT concerned browser-check:110, a line added in loop commit 6bec28b0)
- [CONVENTION] plan file:35 - Verification section did not record the added coverage --> FIXED b37a56ef (plan updated)
- [NIT] web.reauth-1492.test.js:77 - the lifted openAcctAdd test relied on sloppy-mode implicit-global creation for the new ACCT_ADD_RETURN_FOCUS --> FIXED b37a56ef (declared it in the prepend, matching ACCT_REAUTH_DIR)
- [NIT] render-detail-openai-model-2140.js:110 - connectFocusReturns only strictly non-vacuous if focus leaves the button on open --> DEFERRED: already MEASURED red-capable (reverting closeAcctAdd's return-focus makes connectFocusReturns false + FAIL), which empirically proves focus leaves the button and the assertion tests restoration

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 (finding on the branch-base show gate + the coverage file)
- [WARNING] render-detail-openai-model-2140.js:88 - the show-gate's `/not an api key/i` half was only proven POSITIVELY; nothing pinned that a sibling not-listable reason (rejected key 401/403/429) keeps the button hidden, so a future wording drift could silently show Connect on a rejected-key account (remedy is reconnect) --> FIXED acd36053 (added `siblingReasonGate`: an ours+recorded agent with the real 401-invalid_api_key `because` must keep the button hidden; proven red-capable)
- [NIT] render-detail-openai-model-2140.js:262 - when the button never shows, connectShown and connectFocusReturns both fire (redundant signal) --> FIXED acd36053 (gated the focus-return assertion on connectShown)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT (plus 1 WARNING that dedups to ledger #2, and a positive note on the plan)
**Self-generated:** 0
**Converged** - no new actionable findings.
- [WARNING] web/index.html:28927 - two frontend derivations of the not-an-api-key fact (show gate + openaiNoModelsNote) --> DEDUP of ledger #2, DEFERRED. Re-examined on this escalation: the shared-predicate fix touches 4 lifted-function test files (1 lifts paintOpenaiDetailModel, 3 lift openaiNoModelsNote), disproportionate to #2802; the risk is bounded because engine/openaiaccounts.test.js:1067 pins the engine string both consumers match, and both use the identical regex. Recorded as a follow-up cleanup.
- [NIT] render-detail-openai-model-2140.js:205 - hideCoverage drives openDetail without try/catch (a throw hard-crashes page.evaluate instead of a clean problem line). Reviewer rated the current fail-loud behavior "acceptable"; NOTED as future polish, not fixed at the convergence point.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | render-detail-openai-model-2140.js | BRANCH | trivially-true coverage; both resets unarmed | FIXED | af5e107a |
| 2 | 1,5 | WARNING | web/index.html:28927 | BRANCH | show gate re-derives not-an-api-key (2 frontend derivations) | DEFERRED | bounded by pinned engine test #1067; shared-predicate fix touches 4 lifted-test files, out of #2802 scope; follow-up |
| 3 | 1 | NIT | web/index.html:18869 | BRANCH | connect listener not null-guarded | FIXED | af5e107a |
| 4 | 1 | NIT | web/index.html:18866 | BRANCH | focus a11y (superseded by #5) | SUPERSEDED | see #5 |
| 5 | 2 | WARNING | web/index.html:18866 | BRANCH | focus strands on close from Model tab | FIXED | 6bec28b0 |
| 6 | 2 | WARNING | web/index.html:28912 | BRANCH | `usable &&` half untested | FIXED | 6bec28b0 |
| 7 | 3 | CONVENTION | plan:35 | BRANCH | plan Verification did not record added coverage | FIXED | b37a56ef |
| 8 | 3 | NIT | web.reauth-1492.test.js:77 | BRANCH | sloppy-mode implicit-global for ACCT_ADD_RETURN_FOCUS | FIXED | b37a56ef |
| 9 | 4 | WARNING | render-detail-openai-model-2140.js:88 | BRANCH | sibling-reason exclusion untested | FIXED | acd36053 |
| 10 | 4,5 | NIT | render-detail-openai-model-2140.js | BRANCH | redundant focus line; openDetail not try-wrapped | PARTIAL | redundant-line FIXED acd36053; try/catch NOTED (reviewer: acceptable) |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] web/index.html:30946 - the ChatGPT note prose and the button label both say "connect an API key" (plan-accepted tradeoff; the plan rejected turning the note into a link)
- [NIT] render-detail-openai-model-2140.js:205 - hideCoverage's openDetail call is not try-wrapped (fail-loud is acceptable; a clean problem line would be tidier)
- Follow-up: extract a shared `not-an-api-key` predicate so the show gate and openaiNoModelsNote have one derivation (convention #5); deferred here because it touches 4 lifted-function test files.

### Strengths (across all iterations)
- Two-layer synchronous-first button reset (per-paint default-hide + openDetail on-open reset) defends both linger paths; stale-generation guards prevent a superseded paint from re-showing the button (iters 1, 3, 5)
- Show gate tightly scoped: rejected/unreachable keys correctly get no Connect button, whose remedy is reconnect (iters 1, 4, 5)
- Reuses the proven openAcctAdd flow and correctly sidesteps the #1918 dead-control trap by using the true modal overlay rather than a Settings-section swap (iters 1, 5)
- No regression to the Settings "+ Add a provider" caller: focus-return falls back to the exact prior element (iter 5)
- Every coverage block proven red-capable by reverting the code under test (both resets, usable-half, sibling-reason, focus-return); the browser-check was run live headless in-review and passed (iters 3, 4, 5)
