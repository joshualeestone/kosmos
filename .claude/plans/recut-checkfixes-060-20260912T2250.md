# recut-checkfixes-060 — unblock the 0.6.60 re-cut

## Problem
The 0.6.60 release cut is blocked by two stale browser-checks (Baron's diagnosis, relayed via Splinter):

- `docs/browser-checks/render-consolidated-layouts.js` clicks `#pj-add-back`, which is now
  `visibility: hidden` in the consolidated layout (`web/index.html`, under
  `html[data-layout="consolidated"]`). Playwright waits for the element to be actionable and
  the click hangs to its 30s timeout, failing the check.
- `docs/browser-checks/render-boot-no-flash.js` asserts the opaque `#boot-cover` covers the
  viewport by comparing `getBoundingClientRect()` right/bottom against
  `window.innerWidth/innerHeight`. Those include the scrollbar gutter, so a correct
  full-viewport cover false-fails "covers" by exactly the scrollbar width whenever a
  scrollbar is present.

Neither is a product defect; both are test-harness bugs that block the cut gate.

## Fixes
1. **render-consolidated-layouts.js:132** — replace the `pg.click('#pj-add-back')` state reset
   with `forceNothingOpen()`, which runs `pjView('list')` (the exact navigation
   `#pj-add-back`'s own click handler performs) and is the file's established reset idiom
   (already used at lines 95 and 118). This line is a between-section state reset, not an
   assertion, so no coverage is weakened.
2. **render-boot-no-flash.js** — compare `getBoundingClientRect()` right/bottom against
   `document.documentElement.clientWidth/clientHeight` (the layout-viewport measure that
   matches `getBoundingClientRect`'s coordinate system) instead of `window.innerWidth/innerHeight`.
   When no scrollbar is present the two are equal, so behaviour is unchanged; when one is
   present the false-fail is corrected without opening a meaningful false-pass window.

## Verification
- `tools/browser-checks.sh` with `KOSMOS_BC_CI_ALLOWLIST="render-consolidated-layouts render-boot-no-flash"`:
  both PASS against the committed fix (the harness freezes the committed HEAD; freeze sha
  confirmed to be this branch's commit, not stale main).
- Full baseline suite (`yarn test` → `tools/run-tests.sh`) green; `bc-surface-map: 0 FAILED`.

## Out of scope
No app/product behaviour change — test-harness corrections only. No `engine/` or `web/` source touched.

## Re-cut (after merge)
`KOSMOS_CUT_CHANNEL=staging bash tools/release.sh 0.6.60` → served staging URL → route to
Splinter → Josh reviews the QA batch. Prod promote is Josh-gated via `promote-channel.sh` and
is not part of this branch. Telemetry (#2960) is deliberately NOT in this cut; it targets 0.6.61.
