# kp-createform-2518: surface-map coverage for render-create-form (create-account-row)

## Goal
Add the `create-account-row` surface token to render-create-form.js, completing the KP
create-journey coverage for #2518. This check was DROPPED from the create batch (#2547)
because its only #create-account-row assertion failed OPEN on a missing element; that was
fixed in #2548 (PR #2554, now on main), which added a fail-closed precondition
(`acctRowHidden !== null`). So the token is now asserted fail-closed and can be mapped.

## Batch (1 check, no-browser)
- `docs/browser-checks/render-create-form.js` -> `create-account-row`
  Fail-closed via the #2548 precondition at render-create-form.js: a missing/renamed
  #create-account-row makes acctRowHidden null, which now REDs the precondition check
  (previously it fell to the orphan-elbow ternary's `: true` default and passed). Distinctive
  to the create form; present in origin/main web/index.html (6 occurrences).

## Token contract
ASSERTED + FAIL-CLOSED (verified: the #2548 precondition I authored reds on a null lookup)
+ DISTINCTIVE. create-account (16x) and create-provider (14x) are also candidates but have
higher over-fire (many cosmetic CSS lines); deferred. This batch keeps the single cleanest,
#2548-unblocked token.

## Validation
- #2529 meta-guard: token present in web.
- bc-surface-map.sh map: emits the annotation.
- gate + helper suites green; covering names the check on a web token change.
- full node suite + test:shell; blind challenge-loop; 0 em dashes.
