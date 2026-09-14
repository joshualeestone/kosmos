# Plan: consolidated-view settings top + right margin (#3054)

Branch: `consolidated-settings-margin-3054`
Card: #3054 (enhancement). Source: Josh 6.63 testing, 2026-09-14, filed by Splinter, for 6.65.

## Goal / done condition
In the consolidated view, opening user settings (relocated into the display column by #2842) no
longer slams Your Profile against the very top or the content box against the right edge. The
settings panel gets a top + right inset so the content has breathing room. Verified by a headless
render (computed padding + screenshot) in the render-consolidated-settings-2842.js browser-check.

## Cause
`#2842` relocated `#panel-settings` into consolidated column 2 with `margin: 0; width: 100%` (to
fill the column instead of centering). In the tab view the panel's own inset gives the content
top/side room; the consolidated relocation dropped it, so padding was 0 on all sides (measured:
padTop 0, padRight 0, panel right edge at the viewport edge 1280).

## Fix
One line: add `padding: 24px 24px 0 0` (top 24, right 24, bottom 0, left 0) to the consolidated
`#panel-projects > #panel-settings` rule. Padding, not margin: the panel is `width: 100%` in a grid
cell and `box-sizing: border-box` is global (web/index.html:345), so padding insets the content
without overflowing the column (a margin-right would). Left stays on the grid column-gap (18px);
bottom stays 0 (it scrolls). Because padding is inside the border-box, the panel's border-box width
is unchanged, so #2842's "settings FILLS the display column" assertion (which measures the
border-box) still passes (verified: settingsWidth 878 unchanged, leftGapPastList 18).

## Files
- `web/index.html`: the one CSS rule (added `padding: 24px 24px 0 0`) + its comment.
- `docs/browser-checks/render-consolidated-settings-2842.js`: added a padTop/padRight computed-style
  capture and a `#3054` arm asserting both > 0. Compatible with the existing #2842 fill arm.

## Verification
- render-consolidated-settings-2842.js (hermetic, light + dark): 26/26 pass with the fix.
- Negative control (padding removed): the #3054 arm FAILS in both themes (padTop 0, padRight 0)
  while the #2842 fill arm still passes, proving the new arm discriminates and the padding does not
  break the fill guarantee.
- Screenshots before/after confirm Your Profile and the content card now have top + right breathing
  room, no longer at the edges.
- Browser-check surface gate (#2518) and coarse gate (#1720) both exit 0.

## Weakest premise
That 24px is the right inset. It matches the app's standard gutter feel and gives clear breathing
room; Josh's in-app pass on 6.65 is the final call, and it is a one-number change if he wants more
or less. Bottom stays 0 (the panel scrolls); if he wants a bottom inset too that is a small add.

## Decision recorded
Padding over margin (border-box + width:100% would overflow on margin-right). Top + right only, per
the card ("Both of those need margin added on the top and on the right"); left relies on the grid
column-gap, bottom on the scroll. Scoped to the consolidated relocation (the tab-view panel already
has its inset), so `body.consolidated` only.
