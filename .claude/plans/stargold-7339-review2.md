# stargold-7339, blind review 2 (final round, whole branch)

Branch `stargold-7339` vs `origin/main` (4 commits, 08e2db7b87..b1e1210a5c). Every line of `web/index.html`, `docs/browser-checks/render-star-6719.js` and `docs/browser-checks/mobile-shots.js` in the diff read as new. Review 1 was read only after the findings below were measured.

Counts: 1 BLOCKER, 3 WARNING, 4 NIT.

The measure used throughout is the branch's own drawn-edge measure (render-star-6719.js:316-336), copied verbatim into scratch scripts that boot the shipped page the same way the check does (its `open()` helper, KOSMOS_PAGE pointed at the page under test), and applied to EVERY starred star on the page rather than only `#grid .astar` first, plain and hovered. "share" below is that measure's figure; the check's pass line is 0.80.

## Findings

### [BLOCKER] web/index.html:2956 and 2968 with 5641, the 15px rail star fails the branch's own drawn-edge measure at 1x and at 1.5dppx; hovered on a working or needs-you row no pixel reaches 3:1 at all

The rail star is 15px (web/index.html:5641), so the 1.6-unit edge is 1.0 CSS px at 1x, and the 1-unit edge from `min-resolution: 1.5dppx` (line 2968) is 0.94 device px at 1.5dppx. Both are below the width the CSS comment at 2961-2962 says a line needs before it stops blending into the fill. On main the rail star was filled with the edge colour, so this is a regression only this branch introduces. The check never sees it: its pixel arm shoots only `#grid .astar.on` (render-star-6719.js:316), whose first star is a plain white tile, the easiest ground there is.

MEASURED, real page, consolidated layout, every rail row's star starred (share; maxR is the best pixel anywhere on the star against its ground):

| rail row | chromium 1x | webkit 1x | chromium 1.5x | webkit 1.5x | 2x (both) |
|---|---|---|---|---|---|
| plain row | 0.75 | 1.00 | 0.81 to 0.85 | 0.90 to 0.98 | 1.00 |
| working row | 0.59 | 0.81 | 0.47 | 0.84 | 1.00 |
| needs-you row | 0.59 | 0.81 | 0.40 to 0.56 | 0.78 to 0.89 | 1.00 |
| plain row, hovered | 0.56 | 0.72 | 0.24 to 0.45 | 0.51 to 0.62 | 0.97 / 1.00 |
| working row, hovered | 0.00 (maxR 2.97) | 0.72 | 0.15 | 0.37 | 0.79 / 0.97 |
| needs-you row, hovered | 0.00 (maxR 2.97) | 0.72 | 0.06 to 0.08 | 0.37 to 0.40 | 0.73 / 0.97 |

The 18px grid star is fine at 1x and 2x (1.00 plain on every tile ground, 0.95 hovered on washed tiles), but at 1.5dppx (a Windows laptop at 150%, which `min-resolution: 1.5dppx` sends to the 1-unit edge) a hovered needs-you tile drops to 0.74 (chromium) and 0.80 (webkit). So the 1.5dppx breakpoint is too low for the grid too, only less badly.

Fix (MEASURED): size the edge in screen pixels instead of SVG units, so it is the same line at 15px and 18px, and keep the thin line for 2dppx and up only:

```css
.astar.on svg path { fill: var(--gold-bright); vector-effect: non-scaling-stroke; stroke-width: 1.5px; }
@media (min-resolution: 2dppx) { .astar.on svg path { stroke-width: .75px; } }
```

With that in a copy of the page: every rail and grid star, plain and hovered, every ground, scores 1.00 at 1.5x and 2x in both engines and 1.00 plain at 1x; the one cell under 0.80 left is chromium 1x rail hovered on a washed row (0.77). Then add the rail to the pixel arm (the same `measure()` on `#alist .lrow .astar.on svg` after `data-layout="consolidated"`, as the existing rail arm at 349ff sets up), on a washed row and hovered, at 1x, 1.5x and 2x. Its control is already in this table: the current branch CSS fails it. The thicker edge costs some bright interior at 15px; that is the trade, and it is what makes the bright fill legible as a star on light.

### [WARNING] docs/browser-checks/render-star-6719.js:271-298, the dark and in-app dark arms cannot go red if the dark edge is put back to the dingy gold, and nothing covers min-resolution or forced colors

The dark arms assert the fill is --gold-bright, the stroke equals the button colour, and the edge is 3:1. `--gold-deep` (the old, dingy edge) is 5.08:1 on the dark grounds (the check's own `brandMin` in the log), so a revert passes. MEASURED mutation control (copy of the page, check run with KOSMOS_PAGE, chromium): web/index.html:2966 and 11702 both back to `var(--gold-deep)`, line 2968 (`min-resolution`) deleted, and line 2970 (`forced-colors`) deleted, all at once: 86 PASS, 0 FAIL. So four of the branch's six CSS lines can be reverted with the suite green. The forced-colors line is load-bearing (MEASURED, chromium `forcedColors: 'active'`: with it the fill is rgb(0,0,0), without it rgb(227,179,65) inside a black outline). Also not covered: data-theme="light" on a dark system (the `:root:not([data-theme="light"])` carve-out), though `tools/sync-forced-theme.js --check` (rc 0) guards that generated pairing.

Fix: in the dark and in-app dark arms, assert the edge equals --gold-bright (as the fill is); add a forced-colors arm in chromium (`forcedColors: 'active'`, assert path fill equals the button's computed colour); assert the computed `strokeWidth` at dsf 2 is the thin value so the breakpoint is shown to match (WebKit does match it: MEASURED, `matchMedia('(min-resolution: 1.5dppx)')` true and strokeWidth 1px at dsf 2 in both engines).

### [WARNING] docs/browser-checks/render-star-6719.js:316 and 325, the ground is read from the screenshot's corner pixel, which only holds for the grid star

`padding: 3` around an 18px svg in a 36px button keeps the whole shot inside the button, so `px(0, 0)` is the tile ground, hovered or not (MEASURED: corner and the other three corners agree within 1 level on every grid tile, plain and hovered). For the rail star (15px svg in a 26 x 20 button, border-radius 6px) the vertical margin is 2.5px, so a padding of 3 puts the corner 0.5px outside the button and past its rounded corner: on a hovered rail star the corner is the row, not the hover fill, and the measure would compare against the wrong ground. It did not bite in my runs (corners agreed within 1 level) because the hovered rail shot is mostly the hover fill, but it will matter the moment the arm is extended as the blocker asks. A focus ring (outline-offset 1px, outside the button) is outside the 3px pad on the grid star, so focus does not disturb it there. Fix: pad by 2 for the rail, or take the ground as the median of the four corners and assert they agree, failing the arm if they do not. REASONED from geometry, corners MEASURED.

### [WARNING] docs/browser-checks/render-star-6719.js:312-347, the pixel arm measures one tile, on the easiest ground, never hovered

`#grid .astar` first is a stopped agent on a white tile: the edge colour's best ground (4.26:1). The washed grounds where the colour is 3.68 to 3.74, the list row, the hover fill (which takes the colour to 3.23 to 3.43 on light) and the focus state are never photographed. With the current CSS the 18px grid star passes all of them at 1x and 2x (MEASURED above), so this is a coverage gap rather than a live defect at 18px, but it is the gap the blocker came through. Fix: loop the measure over a plain, working and needs-you tile and a list row, each also hovered (`page.hover`), at 1x, 1.5x and 2x.

### [NIT] web/index.html:2958-2961, "3.4 to 3.9:1 as a colour on the light tile and row grounds"

MEASURED from the page tokens: #9c741b is 4.26 on the plain white tile, 3.93 on the list row, 3.74 working, 3.68 needs-you; hovered it is 3.23 to 3.70. 3.4 is only reached on the hidden new-look ground. Fix: "3.7 to 4.3:1 on the light tile and row grounds, 3.2 hovered".

### [NIT] web/index.html:2961-2963, the widths in the comment describe the 18px star only

"1.6 units (about 1.2px on the 18px star)" and "1 unit on a sharper screen, where the thin line still holds" are not true of the 15px rail star (1.0px and 0.94 device px at 1.5dppx; see the blocker). Fix with the blocker; if the edge moves to screen pixels the comment becomes one width per screen density.

### [NIT] docs/browser-checks/render-star-6719.js:21, the header still lists the old contrast arm only

It says "a filled star is at least 3:1 on every tile and row ground in both themes"; the file now also checks the --gold-bright fill, the drawn stroke, an in-app dark arm, and the drawn-pixel edge at 1x and 2x with two controls. Fix: add those lines to the header.

### [NIT] docs/browser-checks/render-star-6719.js:270-274, "forced-dark" names the in-app Dark setting next to a CSS rule for forced colors

The same diff adds `@media (forced-colors: active)` (high contrast). A reader seeing `forced-dark` in the check and "forced" in the CSS will take one for the other. Fix: call the arm `app-dark` (or `data-theme-dark`).

## What I checked

- Full diff `origin/main...HEAD`, 3 code files, read line by line; `.astar` base, hover (same specificity as `.astar.on` and earlier, so a starred star keeps its colour on hover; its background still changes), touch sizes, the consolidated rail (5630-5655), the generated `:root[data-theme="dark"]` copy at 11702 (`node tools/sync-forced-theme.js --check` rc 0), STAR_SVG (viewBox 24, 18px).
- render-star-6719.js on the branch, both engines: 170 PASS, 0 FAIL, exit 0. Pixel arm results 1.00 at 1x and 2x, controls 0.55 to 0.60 (1-unit edge) and 0 (no edge).
- Mutation control (page copied to my scratchpad, check pointed at it with KOSMOS_PAGE, worktree untouched): dark edges back to --gold-deep, min-resolution rule removed, forced-colors rule removed: 86 PASS, 0 FAIL (chromium).
- Scratch probes (in my scratchpad, using the check's own `open()` and `measure()`): every grid tile and every rail row star at 1x, 1.5x and 2x, plain and hovered, chromium and webkit; a standalone page with the branch CSS for the list row; the candidate fix measured the same way.
- Forced colors in chromium with and without line 2970; `min-resolution` matching and computed stroke width at dsf 2 in both engines.
- Colour ratios of #9c741b and --gold-bright on every light, dark, new-look and navy ground including the hover fill (dark: --gold-bright 5.8 to 9.1).
- mobile-shots.js: both screens, the harness runs `after` whatever `go` did (3611-3614); both PUTs throw on non-200; shots in ~/work/design-shots/kosmos-7339 viewed (desktop light grid). No rail shot exists among them.
- web.label-contrast.test.js and web.gold-edge-1044.test.js from the repo root: 14/14 pass. No unit test references `.astar`.
- Not run: focus-visible pixel state (REASONED clear of the measure on the grid star, above).
- `git status --porcelain`: only this review file.

## Author's response (Mona Lisa, 09:2x CDT)
- BLOCKER (the 15px rail and the hovered washed grounds): FIXED with the reviewer's tested fix. The edge is drawn in screen pixels (`vector-effect: non-scaling-stroke`): 1.5px, and .75px at 2dppx and up. I added a darker light-mode edge on hover (#7d5c13), which closes the one cell the fix left (a hovered rail star on a washed row at 1x, 0.77).
- W1 (four lines revertible with the suite green): FIXED. The check now asserts the dark edge is --gold-bright on both dark paths, asserts .75px at 2x, and has a Chromium forced-colors arm (the fill becomes the system colour).
- W2 (corner ground outside the rail button): FIXED. The ground is read 1px around the icon, inside its own button, so a hover tint is the reference.
- W3 (one tile, the easiest ground, never hovered): FIXED. The check measures every grid star and every consolidated-rail star, on their own grounds (plain, working, needs-you), at rest and hovered, at 1x, 1.5x and 2x, in both engines.
- Control: the new check run against this branch's previous CSS (b1e1210a5c) fails 8 checks, the rail and the hovered washed grounds, as review 2 measured. The current CSS gives 212 PASS, 0 FAIL.
- NITs: the comment's contrast range is corrected to 3.7 to 4.3:1 and its widths are restated in screen px. The `forced-dark` arm is named "edge colour" now.
