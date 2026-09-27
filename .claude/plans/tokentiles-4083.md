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
- The hero number is `clamp(18px,6cqi,64px)` (was `26px,8cqi,80px`): a little smaller, sized so a
  7-character headline ($135.0M, $999.9K, 150.0B) keeps 12px or more off the tile edges on a desktop and
  at 390 wide. Measured margins for $135.0M on a 390px phone, the tightest case, per setting tried:
  `clamp(24px,6.5cqi,64px)` 7.86px (font at its 24px floor); `clamp(20px,6.5cqi,64px)` 11.39px (22.23px);
  `clamp(18px,6cqi,64px)` 14.83px (20.52px), shipped. On a desktop it is 26.94px.
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

The 12px margin arm has 2.8px of headroom on a 390px phone (14.83px measured). A machine whose monospace
font runs wider could red it; the arm prints every width and the font size, so such a red explains itself.

Subgrid needs Safari 16+ / Chrome 117+. Checked: the Mac app's floor is macOS 13.5 (`install/setup.sh`
MACOS_FLOOR_MAJOR/MINOR, held to `tools/macos-floor` by check-floor-consistency.sh), whose WebKit is a
Safari 16.x release (subgrid arrived in 16.0); Windows' WebView2 is an evergreen Chromium. So no
supported install lacks it. Without it the `subgrid` value would be dropped and a wrapping label would
lift its tile again, as before.

Coverage given up: with the smaller headline the full $176,332 now fits the cost tile at both 1280 and
390 wide (measured; a phone arm asserting it clips there was added and went red, so it was removed). So
no check shows the #3137 abbreviation is still needed at any width measured here; it stays in the code,
and the desktop control still proves the fit check can see a clip. And the 12px margin is measured for a
7-character headline: the human-cost formatter reads $1B or more as $1000.0M (8 characters, there is no B
band), which would sit tighter on a phone. That formatter is not changed here.

The stat row's numbers keep their size (`clamp(20px,6cqi,36px)`): Josh's "a little smaller" was about the
big pair crowding their edges; the baseline, divider and centring fixes cover both rows.
