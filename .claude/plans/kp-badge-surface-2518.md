# kp-badge-surface-2518: surface-map coverage for the account badge + re-auth reach checks

## Goal
Grow the #2518 browser-check surface map (the `// Browser-check-surface:` annotation
consumed by tools/lib/browser-check-surface-gate.sh) to cover two more KP-journey /
report-interface-lane checks, so a web/index.html change to those surfaces re-runs the
check instead of staling it silently until the next cut.

This is a #2518 map-growth batch, data-only (annotation comments), same shape as the
connect+trust (#2544), create (#2547), and OpenAI (#2549) batches.

## Batch (2 checks, no-browser)
- `docs/browser-checks/render-account-badge-1921.js` -> `acct-connected acct-none acct-unknown`
  The three account-badge state classes. All three are ASSERTED FAIL-CLOSED: the check
  selects `.acct-connected, .acct-none, .acct-unknown` per row and pushes a problem when
  the class it expects is absent (a rename yields a null badge lookup -> `!got.cls` ->
  FAIL). Distinctive to the #1921 liveness-badge honesty invariant (a merely-existing
  credential must render muted, never green).
- `docs/browser-checks/render-reauth-reach-1918.js` -> `d-reauth`
  The "Sign in again" re-auth button id. Asserted fail-closed: the check does
  `getElementById('d-reauth').hidden = false` then `.click()`; a rename makes the lookup
  null and the check reds (non-zero exit; the IIFE does not catch the evaluate throw).
  Distinctive to #1918.

## Token contract (proven across #2544/#2547/#2549)
Each token is (1) ASSERTED by the check (a rename must red it), (2) FAIL-CLOSED (a null
lookup FAILS, never default-passes), (3) DISTINCTIVE (not a generic shared id). Verified
fail-closed upfront by reading each assertion.

## Validation
- tools/test-browser-check-surface-map.sh (#2529 dead-annotation meta-guard: every token
  present in web/index.html) -- all 4 tokens confirmed present on origin/main.
- tools/bc-surface-map.sh map -- emits the new annotations.
- tools/lib/browser-check-surface-gate.sh -- gate green.
- full node suite + test:shell.
- blind challenge-loop review; 0 em dashes.

## Not in this batch
- sign-in board (render-board-signin-403-2023): keys on generic #pj-list; needs a
  distinctive/text token, deferred.
- ~100 checks still unannotated; grown batch-by-batch.
