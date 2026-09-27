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

`render-token-usage-2617.js`, at the production-scale headline, with one hero label wrapping and the
other not (a precondition): the two hero numbers' text bottoms are equal, the hero dividers are level,
the three stat dividers are level, every label is centred in its area within 1px, and the hero numbers
keep 12px off the tile edges.

## Weakest premise

Subgrid needs Safari 16+ / Chrome 117+; the Mac app's WKWebView and Windows' WebView2 on supported OS
versions have it, but an older macOS WebKit would fall back to each tile laying out alone (the old look),
not break.
