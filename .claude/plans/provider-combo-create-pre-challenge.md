---
pre_challenge: true
method: challenge-loop
branch: provider-combo-create
diff_hash: 4d4464e29901fdb789edbd3a3d66c84e7cd8405a0fd07007635c8772719fc2e8
validation: passed
subdir_audit: passed
timestamp: 2026-09-09T10:54:00Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (initial validation + 2 blind reviews, sonnet/opus)
**Converged:** Yes (iteration 2, opus: 0 BLOCKER/WARNING/CONVENTION; 2 low-risk NITs deferred)
**Total findings:** 0 BLOCKER, 1 WARNING, 0 CONVENTION, 3 NITs -- WARNING fixed, NITs deferred-with-reason

#1040 2b-logos, final select: apply the proven `enhanceProviderSelect` helper to the last of the
three provider selects, `#create-provider` (Create Agent form). #d-provider (#2495) and
#acct-provider-pick already shipped. One call + a scoped CSS width rule + an extended browser-check.

### Per-iteration
- **Iter 0 (validation):** full run-tests.sh 5401/0; render-provider-combobox-1040.js green headless
  (chromium+webkit) over all three selects, both themes.
- **Iter 1 (sonnet):** [WARNING] #create-provider is the FIRST enhanced select in a fixed-width
  (18rem) stepped flex row (#cstep-name .msteps .frow, elbow-aligned with #create-account/#create-model);
  enhanceProviderSelect clips the native select and inserts a .pcombo with no width of its own, so the
  widget would size to content and break the row alignment Josh tuned. FIXED: scoped rule
  `#cstep-name .msteps .frow > .pcombo { flex:0 1 18rem; width:18rem; ... }`, guarded by a new
  [create-width] browser-check assertion (widget width == sibling #create-model within 2px, > 200px),
  proven RED without the rule (widget 180px vs 288px). [NIT] an unwrapped header comment line -> FIXED.
- **Iter 2 (opus):** 0 BLOCKER/WARNING/CONVENTION. Independently PROVEN non-vacuous (perturbed the
  selector -> [create-width] red {tw:180,mw:288} -> reverted). 7 STRENGTHs: selector correct + correctly
  scoped (.pcombo is a direct child of the .frow via insertBefore; #cstep-name excludes the other two
  selects); no reactivity loop (applyCreateProviderUI only READS create-provider.value; value-setter wrap
  covers resetCreateProvider's no-dispatch set; idempotent dataset guard); no sibling check regressed
  (render-accounts-openai selectOption on the clipped select works, as it already does for the shipped
  #d-provider/#acct-provider-pick); full APG combobox a11y intact; no em dashes. 2 NITs DEFERRED (below).

### Final Ledger
| Iter | Cat | Where | Status |
|---|---|---|---|
| 1 | WARNING | #create-provider .pcombo not inheriting the 18rem stepped-row width (alignment) | FIXED (scoped CSS + width-parity assertion, proven RED without it) |
| 1 | NIT | unwrapped browser-check header line | FIXED |
| 2 | NIT | un-hide loop handles hidden-attr + inline display:none, not class-toggled visibility | DEFERRED (current DOM uses the hidden attr; works; future-proofing note only) |
| 2 | NIT | tw>200 collapse-guard leans on the ~180px content size of the 'anthropic' default | DEFERRED (the |tw-mw|<=2 parity check is primary and covers it regardless) |

### Verification
full run-tests.sh EXIT=0 (5401 tests, 0 fail; browser-check surface gate 0 FAILED, #1720 gate green);
render-provider-combobox-1040.js passes headless chromium+webkit over ALL THREE selects (incl.
create-provider, both themes) + the [create-width] parity assertion, proven non-vacuous by perturbation
(both iterations). No node test pins the enhanced-select set; web.provider-menus.test.js (option
agreement) stays valid because the native select + options are preserved as source of truth.

### Strengths
[STRENGTH] Applies a pattern already CI-verified on two live sibling selects; the native <select> stays the source of truth, all existing create-form handlers keep working (helper commits via select.value + dispatched change).
[STRENGTH] The alignment fix is scoped to #cstep-name (cannot touch the other two selects) and guarded by a perturbation-proven width-parity assertion against an unchanged sibling control.
[STRENGTH] No reactivity loop / double-fire; idempotent; a11y (APG select-only combobox) intact; no em dashes.
