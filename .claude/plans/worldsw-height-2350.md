# worldsw-height-2350: match the multi-Kosmos switcher height to the light/dark switcher

kosmos#2350. Josh (2026-09-06, #admin): "make the multiple Kosmos dropdown box the same
height as the icon... the same height as the light/dark switcher." Cut-gating tweak for
0.6.40 (rides in before Baron's cut, which is holding for #8).

## Problem

The multi-Kosmos switcher control (`.worldsw-btn`, the box beside the K mark in the app
header) is content-height-driven: `padding: 4px 8px` + `font: 12px/15px` + `0.5px` border
= ~25px rendered. The light/dark switcher (`.themepick`) on the same header icon row
renders 32px (its 30px `.themeopt` segment + the 0.5px control border rounding to 1px each
side). So the switcher sits ~7px shorter than the theme toggle and the two do not read as
a matched set.

## Fix

Give `.worldsw-btn` an explicit `height: 32px` (global `box-sizing: border-box`), and drop
its vertical padding (`4px 8px` -> `0 8px`); `align-items: center` centers the text and
chevron in the taller box, horizontal padding stays. Both controls already carry the same
`0.5px` border and `--radius-control`, so equal height is the only remaining difference,
and they now render as a matched pair.

## Why an explicit 32px (not a shared token)

There is no shared control-height token; the theme/view/lay controls pin their geometry to
each other via `web.theme.test.js`, but `.worldsw-btn` is not part of that pinned set. An
explicit 32px lands the same rendered height today, and the new browser check pins the two
LIVE heights equal (not a magic number), so a future change to either control re-surfaces
here rather than drifting silently.

## Verification

- `docs/browser-checks/render-worldsw-height-2350.js`: reveals `#worldsw`, gives it a name,
  and asserts `#worldsw-btn` rendered height == `.themepick` rendered height at DPR 1 and
  DPR 2. Control: pre-fix page measures 25px vs 32px and reds. Registered in
  `tools/browser-checks.sh` + a README row.
- Sibling switcher checks and `web.theme.test.js` (13/13) unaffected. Full node suite green
  (the #1864 reason-grep count tripwire fired for the new check's two quotable emit sites;
  counts bumped 59->60 and 35->36 deliberately). Challenge-loop converged.

## Follow-up

Josh eyeballs the match on his fresh-install 0.6.40 re-test (font smoothing / exact metrics
on his Mac). A one-line height tune if it reads off.
