# tokentiles-4083: Token Usage tiles on one baseline, dividers level, labels centred (#4083)

## Why

Josh, 2026-09-26 22:25 (Settings > Token Usage): the two big numbers are not on one baseline (the right
one sits higher), the numbers crowd the tile edges, the lines above the labels are at different heights,
and the labels should be vertically centred. Cause: each tile was its own flex column, so a label that
wrapped to two lines ("APPROXIMATE HUMAN COST") took height from its own number area, lifting its divider
and its number.

## The change (web/index.html, the #usage-hero CSS only)

- Each row of tiles (`.tv-heq`, `.tv-stats3`) is a grid with two rows, the number and the label, and
  every tile takes them through `grid-template-rows: subgrid`. The tallest label sets the label row for
  all tiles in that row, so the dividers are level and the number areas are equal; same-size numbers in
  equal areas share a baseline. The `=` spans both rows.
- `.tv-flabel` centres its text vertically (flex).
- The hero number is `clamp(24px,6.5cqi,64px)` (was `26px,8cqi,80px`): a little smaller, sized so a
  7-character headline ($135.0M, $999.9K, 150.0B) keeps a margin in the narrowest tile.
- On a phone (one column) the stat tiles stand alone, so they go back to a plain column with their gap.

## The check

`render-token-usage-2617.js`, at the production-scale headline, at 1280 and at 390 wide. Whether a real
label wraps depends on the machine's monospace font, so the check sets one short and one long label in
each row itself (restoring them after): the two hero numbers share a baseline, the hero dividers are
level, the three stat dividers are level (desktop; on a phone they stack), every label's text is centred
in the band between its line and the tile bottom within 1px, and the hero numbers keep 12px off the
tile edges. Each arm was shown red: main's CSS (baselines 7px apart, dividers 14px, 5px margin) and the
label centring removed (-7px).

## Weakest premise

Subgrid needs Safari 16+ / Chrome 117+. Without it the `subgrid` value is dropped: each tile stays a grid
whose own two implicit rows split the parent rows' height, so it does not break, but the rows are not
shared and a wrapping label lifts its tile again, as before. Whether the Mac app's supported macOS
versions all ship a WebKit with subgrid was not checked here.
