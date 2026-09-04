---
pre_challenge: true
method: challenge-loop
branch: picker-provider-aware-2097
diff_hash: ca537a2d840866a10b292aac204316a223f1332d547a1c8ffb5f086d81621e65
validation: passed
subdir_audit: passed
timestamp: 2026-09-04T04:53:29Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7
**Converged:** Yes (iteration 7 returned no blocker/warning/convention)
**Total findings:** 1 BLOCKER, 5 WARNINGs, 3 CONVENTIONs
**Fixed:** 1 BLOCKER + 5 WARNINGs + 1 CONVENTION | **Deferred:** 2 CONVENTIONs | **Asked:** 0

### Change under review (#2097 + #2098)

The create-agent picker in `web/index.html` is made provider-aware. On OpenAI the model SELECT
row (`#create-model-row`) is hidden WHOLE with a "OpenAI picks its own model for now." note (a
sibling) in its place; on Anthropic the model row shows. The provider defaults to OpenAI only when
OpenAI is the sole usable provider, re-applied after the accounts fetch behind a
`CREATE_PROVIDER_TOUCHED` sentinel so a deliberate pick (manual or import) is never overridden. The
account row stays shown at one account (honoring a documented Josh ruling). Plus a browser check,
node tests, reason-grep count bumps (38/20), a README index row, and a browser-checks loop entry.

Reviews were run by fresh, blind challenge agents (one per iteration, no knowledge of prior
findings). The orchestrator held the ledger and fixed each finding.

### Per-Iteration Breakdown

#### Iteration 2
- [BLOCKER] applyCreateProviderUI: the "OpenAI picks its own model" note stayed HIDDEN on OpenAI (`#create-model-why` ships `hidden`, only paintModelWhy managed it and it is not called on the OpenAI branch) -> an empty gap where the model row was; the browser check gave a false green reading `textContent` of a hidden element --> FIXED: `why.hidden=false` on OpenAI in applyCreateProviderUI + loadCreateExtras; browser check now asserts `whyHidden`.

#### Iteration 3
- [CONVENTION] docs/browser-checks/README.md:146: em dash in the new index row (violates the no-em-dash rule) --> FIXED: replaced with a hyphen.
- [WARNING] resetCreateProvider: comment said "connected" but the code checks account presence --> FIXED: comment corrected to "has an account for".

#### Iteration 4
- [WARNING] resetCreateProvider/loadCreateExtras: the provider-aware default was inert on the FIRST create of a page session (resetCreateProvider decides before CREATE_ACCOUNTS is fetched), so an OpenAI-only machine defaulted to anthropic until the 2nd create --> FIXED: loadCreateExtras re-applies the openai default once the real account list lands.
- [CONVENTION] the browser check reads `.hidden` not computed `display` --> DEFERRED: `[hidden]{display:none!important}` (index.html:439) makes `.hidden` a real visual hide, and the check also asserts the note text; minor.

#### Iteration 5
- [WARNING] loadCreateExtras: the value-equality guard (`prov.value === 'anthropic'`) could not tell an untouched default from an import that set 'anthropic' deliberately; importLoad is a THIRD loadCreateExtras caller that sets the provider explicitly, so on an OpenAI-only machine an imported Claude agent could be silently flipped to OpenAI, and the justifying comment asserted a false invariant --> FIXED: replaced value-equality with a CREATE_PROVIDER_TOUCHED sentinel (cleared by resetCreateProvider, set by the create-provider change handler which fires on a manual pick AND importLoad's dispatch); comment corrected; sentinel source-pinned as armed.
- [CONVENTION] the first-create re-default has no executable test (async + fetch, not eval-executable) --> DEFERRED: source-pins red on reversion; documented compromise.

#### Iteration 6
- [WARNING] fillCreateAccounts: the account-row hide (`acctRow.hidden = usable.length <= 1`) REVERSED a preserved Josh ruling documented at the account markup (index.html ~8037: "shown even at one account", the middle rung of the provider->account->model narrowing) --> FIXED: removed the hide, the `create-account-row` id, and the contradicting comment; the `#2097(2)` test now asserts the row is NOT hidden. Flagged his-vs-his (old documented ruling vs the #2097 suggestion) to Josh via Splinter; reversible.

#### Iteration 7
**Converged** -- 0 BLOCKING, 0 WARNING, 0 CONVENTION. The reviewer confirmed the account-row hide is fully removed with no orphans; the OpenAI note renders and is never re-hidden; the model row hides on OpenAI only; the hidden model select never submits a stale value (value-gated at submit, `prov !== 'openai'`); the CREATE_PROVIDER_TOUCHED sentinel cannot be stale across form opens (cleared on every openCreate/refillDetails path) and cannot override a deliberate/import choice in either import ordering (EXTRAS_GEN-guarded); the tests are non-vacuous (red on origin/main); reason-grep counts are 38/20; the README row is present; and tools/browser-checks.sh contains both render-restarting-2019 and render-picker-provider-2097. One informational note only (no defect).

### Final Ledger

| # | Iter | Category | File | Description | Status |
|---|------|----------|------|-------------|--------|
| 1 | 2 | BLOCKER | web/index.html | OpenAI note hidden -> empty gap; browser-check false green | FIXED |
| 2 | 3 | CONVENTION | docs/browser-checks/README.md | em dash in the new index row | FIXED |
| 3 | 3 | WARNING | web/index.html | resetCreateProvider comment said "connected" | FIXED |
| 4 | 4 | WARNING | web/index.html | provider default inert on first create | FIXED |
| 5 | 4 | CONVENTION | render-picker-provider-2097.js | check reads .hidden not computed display | DEFERRED |
| 6 | 5 | WARNING | web/index.html | value-equality guard could override an import; false comment | FIXED |
| 7 | 5 | CONVENTION | web.picker-provider-2097.test.js | first-create re-default source-pin only | DEFERRED |
| 8 | 6 | WARNING | web/index.html | account-row hide reversed a documented Josh ruling | FIXED |

### Outstanding questions (ASKED)
None. The account-row his-vs-his question is a reversible, Splinter-endorsed decision flagged to Josh for a morning re-rule, not a loop blocker.

### Validation

`tools/run-tests.sh` -> VAL_EXIT=0 on the final rebased base (cdc63189). Branch node tests pass; the
browser check `docs/browser-checks/render-picker-provider-2097.js` reds on origin/main (missing
`#create-model-row`) and passes on HEAD. The #1720 browser-check gate is satisfied (the web/ change
adds the committed browser check). Two CONVENTIONs are deliberately deferred with documented reasoning
above; iteration 7 re-raised neither.

### Strengths (iteration 7)
- [STRENGTH] Tests are non-vacuous: origin/main lacks `#create-model-row`, `CREATE_PROVIDER_TOUCHED`, and the provider-aware `resetCreateProvider` (it force-sets 'anthropic'), so the node tests and the browser check all red on main.
- [STRENGTH] The submit path is value-gated (`if (model && prov !== 'openai')`), independent of hide/disable state, so a hidden stale Claude model can never be submitted under an OpenAI key.
- [STRENGTH] The sentinel is armed at both ends (change handler sets it, resetCreateProvider clears it) and the import race is benign in both microtask orderings; no em dashes in any added line.
