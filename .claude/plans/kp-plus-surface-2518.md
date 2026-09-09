# kp-plus-surface-2518: surface-map coverage for the Kosmos Plus checks

## Goal
Grow the #2518 browser-check surface map to cover the two Kosmos Plus (#1615) checks, so a
web/index.html change to the Plus surfaces re-runs the check instead of staling it silently
until the next cut. A #2518 map-growth batch, data-only annotations, same shape as
#2544/#2547/#2549 and the badge batch (kp-badge-surface-2518).

## Batch (2 checks, no-browser)
- `docs/browser-checks/render-plus-gate-1615.js` -> `plus-state1 plus-flow plus-switch`
  The paid-gate surfaces. All asserted FAIL-CLOSED: h('plus-state1') / h('plus-flow')
  return -1 when the id is missing so the height assertions red; plus-switch drives the
  enrolled `switchVisible === true && switchText === 'Turn on'` assertion (null -> FAIL);
  and openPlus's waitForFunction times out (exit 2) if plus-state1/plus-flow are gone.
  Distinctive to #1615 (plus-switch is "the whole bug" surface: the on-switch must be gated).
- `docs/browser-checks/render-plus-blue-1615.js` -> `plus-active plus-stars plus-mark`
  The whole-app blue skin (body.plus-active) + its two canvases. All asserted FAIL-CLOSED:
  a renamed plus-active makes classList.contains false -> `!enterActive` -> problem;
  missing plus-stars/plus-mark -> `!hasStars`/`!hasMark` -> problem. Distinctive to #1615.

## Note on a stale check comment (not fixed here, out of scope)
render-plus-blue-1615.js's header says these tokens "do not exist on origin/main". That is
STALE: the #1615 blue skin has since merged, so plus-active (8), plus-stars (5), plus-mark
(4) are all present in origin/main web/index.html. The annotation is therefore valid; the
stale prose is a separate cosmetic nit.

## Token contract (proven across #2544/#2547/#2549 + badge batch)
Each token is ASSERTED (a rename reds the check), FAIL-CLOSED (a null lookup FAILS, never
default-passes), and DISTINCTIVE. Verified fail-closed upfront by reading each assertion.

## Validation
- #2529 meta-guard (test-browser-check-surface-map.sh): all tokens present in web.
- bc-surface-map.sh map: emits the new annotations.
- gate + helper suites green; covering names both on a web token change.
- full node suite + test:shell; blind challenge-loop; 0 em dashes.
