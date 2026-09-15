---
pre_challenge: true
method: challenge-loop
branch: create-defaults-3081
diff_hash: 2cce055bebbe6a4ddb5a34e01d4fe6cfd5e13c88280c19016c029b236b485e09
validation: passed
subdir_audit: passed
timestamp: 2026-09-15T03:26:55Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 surfaced zero BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 8 (1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 3 NITs) + 2 synthetic BLOCKERs from the 6.0 initial-validation pass
**Fixed:** 6 | **Deferred:** 1 (benign NIT) | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1 (6.0 initial validation pass)
**Reviewer model:** n/a (validation helpers, not a blind agent)
**New findings:** 2 synthetic BLOCKERs
**Self-generated:** 0 (6.0 synthetic findings are BRANCH by instruction)
- [BLOCKER] initial-validation: 4 node tests failed with `CREATE_PREF_OPENAI_MODEL is not defined` — the new module-level one-shot was not declared in the eval wraps of web.picker-provider-2097.test.js / web.picker-openai-model-2140.test.js, which eval-extract resetCreateProvider / paintOpenaiCreateModel in isolation --> FIXED (ce9e417a5): declared it beside its sibling IMPORT_OPENAI_DEFAULT in each wrap.
- [BLOCKER] initial-validation: the test:shell #1720 browser-check gate refused the web/index.html change (no docs/browser-checks/ assertion, no override) --> FIXED (144ade690): the change only pre-selects existing <select> values (no layout/paint dimension a source test cannot see); added a `Browser-check:` override trailer stating why, and pinned the loadCreateExtras restore + create-go save wiring with two source-pattern assertions so a wiring-drop regression reds a node test.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 2 WARNINGs, 2 NITs
**Self-generated:** 0 (all on the original build commit 0be1731f3 = BRANCH)
- [BLOCKER] web.picker-openai-model-2140.test.js — the CREATE_PREF_OPENAI_MODEL one-shot's actual behavior in paintOpenaiCreateModel had zero test coverage (only a bare declaration) --> FIXED (4f01291b3): added 4 runPicker cases (saved model present -> selected; absent -> "Let OpenAI choose"; not-listable account still consumes it; account-less paint survives it), seeding the flag and reading it back synchronously + after the paint.
- [WARNING] web/index.html — the one-shot clear sat AFTER the `gen !== OPENAI_MODELS_GEN` return, so a superseded fetch skipped it and left the flag set for the next account's paint to re-apply (contradicting the code's own "a later manual account change never re-forces it") --> FIXED (4f01291b3): capture BOTH one-shots (saved model + import default) into locals synchronously at the top of the async IIFE and clear the globals there, before the await.
- [WARNING] web/index.html — the provider restore set prov.value without checking pref.provider names an ENABLED <option>, unlike the account/model gating --> FIXED (4f01291b3): gate on `Array.prototype.some(prov.options, o.value === pref.provider && !o.disabled)`, mirroring the import flow's guard.
- [NIT] web/index.html — "empty account = the single-account hidden row" comment was inaccurate --> FIXED (4f01291b3): empty = the zero-usable placeholder; a single usable account still stores its real dir.
- [NIT] web/index.html — saveCreatePrefs partial-write tradeoff undocumented --> FIXED (4f01291b3): documented that each field is re-validated on read, so a half-written triple degrades field-by-field.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
**Converged** — five STRENGTHs confirming the iter-2 fixes (one-shot lifecycle, validity gating, no injection surface, storage try/catch, meaningful tests); one NIT deferred.
- [NIT] web/index.html — applyCreateProviderUI's Claude branch clears IMPORT_OPENAI_DEFAULT but not CREATE_PREF_OPENAI_MODEL (asymmetry) --> DEFERRED. The reviewer classed it benign and self-healing ("not a defect"): the flag holds the user's OWN saved model, so a manual openai->claude->openai round-trip within one open would re-apply the legitimately-saved model (the feature's intent), unlike an abandoned import default which would surprise; it self-heals at the next open via resetCreateProvider. The capture-and-clear-at-top-of-IIFE fix (iter 2) already closes the actual leak path; adding a third clear-site would be redundant and would require editing a pre-existing #2453 comment.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | picker tests | BRANCH | new one-shot global undeclared in eval wraps | FIXED | ce9e417a5 |
| 2 | 1 | BLOCKER | web/index.html | BRANCH | #1720 browser-check gate refused the web change | FIXED | 144ade690 |
| 3 | 2 | BLOCKER | web.picker-openai-model-2140.test.js | BRANCH | one-shot behavior had no test | FIXED | 4f01291b3 |
| 4 | 2 | WARNING | web/index.html | BRANCH | one-shot cleared after the gen guard -> leak | FIXED | 4f01291b3 |
| 5 | 2 | WARNING | web/index.html | BRANCH | provider restore skipped enabled-option check | FIXED | 4f01291b3 |
| 6 | 2 | NIT | web/index.html | BRANCH | inaccurate "empty account" comment | FIXED | 4f01291b3 |
| 7 | 2 | NIT | web/index.html | BRANCH | partial-write tradeoff undocumented | FIXED | 4f01291b3 |
| 8 | 3 | NIT | web/index.html | BRANCH | applyCreateProviderUI one-shot clear asymmetry | DEFERRED | benign, self-heals |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking)
- [NIT] web/index.html — applyCreateProviderUI one-shot clear asymmetry (iteration 3, DEFERRED as benign — see above).

### Strengths (across all iterations)
- The one-shot is captured AND cleared synchronously before the await, closing the superseded-paint leak while preserving the account-less-survive contract (iteration 3).
- Validity gating is the core safety property and is done consistently for provider (enabled option + usable account), account (offered option), and model (in CREATE_MODELS / fetched list) — a stale value degrades field-by-field to the default (iterations 2, 3).
- No XSS/injection surface: every localStorage value reaches the DOM only via `select.value = validatedValue`, never innerHTML (iteration 3).
- Storage try/catch fails soft on both read (all-empty) and write (swallowed); save is correctly gated on outcome === 'created' (iteration 3).
- Tests run the shipped functions against stubs whose controls return the dangerous answer (retired model, removed account, blocked storage) rather than asserting vacuously (iterations 2, 3).
