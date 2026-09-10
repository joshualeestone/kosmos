# createcheck-2548: make two create-flow browser-checks fail-closed

Fixes kosmos#2548 (both bugs I filed from the #2547 surface-annotation loop). No-browser
check-logic fixes; no product/web change.

## Bug 1: render-create-form.js orphan-elbow assertion fails OPEN on a missing account row
The orphan-elbow check (was line ~294):
    check(`... a hidden account rung draws no orphan elbow`,
      seen.acctRowHidden ? seen.acctElbowPainted === false : true, ...)
is fed by `acctRowHidden: id('create-account-row') ? id('create-account-row').hidden : null`.
When #create-account-row is renamed/removed, acctRowHidden is null, the ternary falls to its
`: true` default, and the check PASSES unconditionally, even on a real regression.

### Fix
Add a fail-closed precondition check immediately before it:
    check(`... the account row element renders (#create-account-row present)`,
      seen.acctRowHidden !== null, ...)
acctRowHidden is null exactly when the element is absent, so this reds the check on a
rename. #create-account-row is a static element in web/index.html (6 occurrences), so the
precondition never false-reds in a normal render (#2097 toggles the row's .hidden, not its
existence).

Proven in isolation (the two assertions run for each state):
- missing row (null/null): FAILS now (previously passed) -- fail-closed, correct.
- hidden row, no elbow (good): PASSES -- no false-red.
- hidden row, elbow painted (regression): FAILS -- correct, unchanged.
- shown row: PASSES -- correct.

This also unblocks surface-annotating `create-account-row` for #2518 (dropped from #2547
for exactly this fail-open reason); that annotation is a separate follow-up batch.

## Bug 2: render-createnav-2190.js lacks a top-level .catch
Its sibling checks (render-create-form.js, render-create-made.js) end
`})().catch((e) => { console.error(e); process.exit(1); });`; render-createnav-2190.js ended
`})();`. A rename of #made-head/#create-msg still reds (getElementById(...).textContent
throws -> unhandled rejection -> non-zero exit), so the #2518 contract held, but via an
unlabelled crash rather than a clean FAIL. Diagnostics-quality fix: add the sibling .catch.

## Validation
- valid JS both files; isolated logic proof above; 0 em dashes in the change.
- full node suite + test:shell; blind challenge-loop review.
