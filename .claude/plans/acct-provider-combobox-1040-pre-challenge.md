---
pre_challenge: true
method: challenge-loop
branch: acct-provider-combobox-1040
diff_hash: eabb058f0e5d3485515d5b9ecea7bff06cff751b5815b2f46c9ed0cbcfb818cb
validation: passed
subdir_audit: passed
timestamp: 2026-09-08T20:48:23Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 3 (1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 1 NIT)
**Fixed:** 2 | **Deferred:** 1 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above (ITER_COMMITS empty on the first reviewer pass; 6.0 passed clean, so this was iteration 1 with no prior loop commit to attribute to)
- [BLOCKER] web/index.html:17010 -- `acctReauthChrome` hid `#acct-provider-lab` and `#acct-provider-pick` (the native select) individually, but `enhanceProviderSelect` inserts the visible `.pcombo` widget as a SIBLING of the select (`select.parentNode.insertBefore(wrap, select.nextSibling)`). Hiding the (already visually-hidden) native select therefore left the widget on the "Sign in again" screen, visible and operable; a user could pick OpenAI during a Claude reauth and drive the wrong flow. --> FIXED (commit 02d7b477): hide the whole `#acct-provider-field` container (the same unit `acctShowSuccess`/`closeAcctAdd` already toggle), which covers label + native select + widget.
- [WARNING] web.reauth-1492.test.js:83 -- The reauth-hide assertions (`acct-provider-pick.hidden === true`, and the label at :84) gave false comfort: the harness lifts `acctReauthChrome` against a stub `fakeDom` that never runs `enhanceProviderSelect`, so the `.pcombo` widget the fix must hide does not exist there. The test passed while the real rendered screen leaked the widget. --> FIXED (commit 02d7b477): assert the `#acct-provider-field` container's hidden state (the real hide unit, meaningful whether or not the widget exists), register `#acct-provider-field` in the stub IDS, and add an end-to-end reauth-hide check to `render-provider-combobox-1040.js` that drives the real `acctReauthChrome` against the real enhanced DOM with the dialog open (rendered geometry) -- the coverage the stub-based unit test structurally cannot have.
- [NIT] docs/browser-checks/render-provider-combobox-1040.js:48 -- The inner `for (const { id: selId, claudeVal } of SELECTS)` loop is at the same 2-space indent as the enclosing theme loop, so the body sits one nesting level shallower than its scope. --> DEFERRED: purely cosmetic (node --check passes); this is the file's deliberate double-stacked-`for` style to avoid deep nesting, and re-indenting ~180 lines of loop body would bury the real diff. Non-blocking.

#### Iteration 2
**Reviewer model:** sonnet (different model from iteration 1, per kosmos#2032)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** 0
The sonnet pass independently verified the iteration-1 fix is structurally sound (confirmed the `.pcombo` widget is a child of `#acct-provider-field` via `select.parentNode`), confirmed the stub/browser-check split is honestly scoped, confirmed the `.pcombo-src !important` specificity fix and its no-effect on `#d-provider`, and confirmed `PROVIDER_MARK_KEY.claude` is additive. **Converged** -- no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web/index.html:17010 | BRANCH | reauth screen left the enhanced provider combobox widget visible/operable (sibling of the hidden select) | FIXED | 02d7b477 |
| 2 | 1 | WARNING | web.reauth-1492.test.js:83 | BRANCH | reauth-hide assertion gave false comfort (stub never runs enhanceProviderSelect, so no widget to leak) | FIXED | 02d7b477 |
| 3 | 1 | NIT | docs/browser-checks/render-provider-combobox-1040.js:48 | BRANCH | inner-loop body indentation one level shallow (deliberate double-stacked-for style) | DEFERRED | cosmetic; ~180-line reindent would bury the real change |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] docs/browser-checks/render-provider-combobox-1040.js:48 -- inner-loop indentation (iteration 1; deferred, deliberate style)

### Strengths (across all iterations)
- The `.pcombo-src !important` change is correctly scoped and well-reasoned: the class is only ever added inside `enhanceProviderSelect` to the two enhanced selects, so raising it to `!important` cannot affect any other element, and it correctly beats the `.rm-box-form .tk-inp { width:100% }` (0,2,0) rule (iteration 1).
- Adding `value` attributes to the coming-soon `<option disabled>` rows is safe on every consumer: the change handler ignores non-claude/openai values, the combobox `commit()` refuses aria-disabled options, and `PROVIDER_MARK_KEY` is only read by key lookup, never iterated (iteration 1).
- The browser-check parametrization is solid: `claudeVal` captures the anthropic-vs-claude vocabulary difference, the flip-to-OpenAI-then-back keeps the assertion non-vacuous, and the screenshot filename includes `selId` so the two selects' shots no longer overwrite each other (iteration 1).
- `acctReauthChrome` hiding the whole `#acct-provider-field` container is structurally sound: the widget is a verified child of the container, so the container's hidden state governs it (iteration 2).
- The stub-based unit test is honestly scoped -- it pins only what the stub can see, and the browser-check exercises the real enhanced DOM end-to-end, with a comment stating why the stub can't catch a widget leak (iteration 2).
