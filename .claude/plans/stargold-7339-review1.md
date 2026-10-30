# stargold-7339, blind review 1 (final round, whole branch)

Branch `stargold-7339` vs `origin/main` (3 commits: 08e2db7b87, e956bb5db5, 3f61c3a4ac). Every line read as new.

Counts: 1 BLOCKER, 4 WARNING, 4 NIT.

## Findings

### [BLOCKER] web/index.html:2965, the 3:1 edge does not exist at 1x; the outline the comment relies on is thinner than a device pixel
`stroke-width: 1` is in the SVG's user units (viewBox 0 0 24 24, STAR_SVG at web/index.html:39824), so the stroke is 0.75 CSS px at 18px and 0.625 CSS px in the consolidated rail's 15px star (web/index.html:5636). It is centred on the path, so only half of it (0.375 / 0.31 px) lies outside the --gold-bright fill. At 1x it never paints as #9c741b: antialiasing blends it with the ground.

MEASURED, in the branch's own desktop shot (`/tmp/r-7339/star-grid-7339--desktop--light--chromium.png`, 1280x800, i.e. 1x): the starred tile's ground is #e7f0eb; the darkest pixel on the star's whole outline is #ae8932 = 2.81:1, next #b08c36 2.72, #b08d3b 2.69, #b39346 2.52; no outline pixel reaches 3:1. The nominal #9c741b would be 3.67 on that ground, which is the number the check reports.

MEASURED, standalone render with the exact path and colours, share of outline pixels whose 1-device-px band reaches 3:1 against the ground (chromium / webkit):

| | branch (bright fill, edge 1) | main (fill = edge #9c741b, 1.6) | CONTROL: bright alone, no dark edge | bright fill, edge 1.6 | bright fill, edge 2 |
|---|---|---|---|---|---|
| 1x 18px white | 33% / 25% | 80% / 80% | 0% / 0% | 70% / 75% | 76% / 76% |
| 1x 18px attn ground | 0% / 5% | 80% / 80% | 0% / 0% | 60% / 60% | 71% / 76% |
| 1x 15px white (rail) | 0% / 16% | 88% / 82% | 0% / 0% | 66% / 71% | 75% / 81% |
| 1x 15px attn (rail) | 0% / 16% | 81% / 82% | 0% / 0% | 28% / 32% | 64% / 58% |
| 2x 18px white | 83% / 76% | 79% / 81% | 0% / 0% | 79% / 81% | 86% / 83% |
| 2x 15px attn | 64% / 70% | 69% / 74% | 0% / 0% | 69% / 74% | 89% / 84% |

So at 2x (Retina, iPhone) the thin edge holds about as well as main did; at 1x (any non-Retina display, a Windows PC at 100%, the desktop design shots themselves) the light-theme starred star regresses from an outline that clears 3:1 to one that essentially does not, on every tile ground and worst in the rail. Visually the shape still reads (the shot shows a gold star with a faint fringe), but the branch's stated contract, "the edge is what keeps the star's shape legible there" at 3:1, is false at 1x, and render-star-6719 certifies it (see the next finding).

Fix, in order of preference: (a) keep the thin edge only where it renders: `@media (max-resolution: 1.5dppx) { .astar.on svg path { stroke-width: 1.6; } }` (bright fill keeps ~17-20 of its interior pixels at 18px in my render, against 24-30 with edge 1), and add a 1x pixel arm to the check; or (b) stroke-width 1.6 to 2 everywhere for the light theme only (`:root:not([data-theme="dark"])` scoped plus the system-dark carve-out), leaving dark at 1 where edge = fill and nothing is lost. Either way re-measure the 15px rail star at 1x, which is the worst case.

### [WARNING] docs/browser-checks/render-star-6719.js:286-295, the edge arm measures the button's `color`, not the stroke, so it cannot go red on the edge it guards
`edge = getComputedStyle(st).color` is the colour the stroke WOULD be. Nothing reads the path's `stroke`, `stroke-width`, or any pixel. MEASURED mutation control: with `.astar.on svg path { fill: var(--gold-bright); stroke-width: 0; stroke: none; }` (no edge at all, so the light star is --gold-bright alone at ~1.9:1) the check stays 144 PASS, 0 FAIL in both engines. The fill arm does go red on its own subject: MEASURED, `fill: currentColor` gives 142 PASS / 2 FAIL (light, both engines; dark cannot see it because edge = fill there, which is acceptable).
Fix: read `getComputedStyle(path).stroke` (assert it equals the button colour and is not `none`) and `strokeWidth`, and add a pixel arm: screenshot the starred star at deviceScaleFactor 1 and 2 on the plain and attn tiles and assert a minimum share of outline pixels at 3:1 (my px.js method above; its control, bright fill with no dark edge, returns 0% in every cell, so it can return the dangerous answer). That arm is what would have caught the BLOCKER.

### [WARNING] docs/browser-checks/render-star-6719.js:40 with web/index.html:11697, the forced dark theme is never exercised
The check sets the theme only with `colorScheme: theme` (prefers-color-scheme) and never sets `data-theme`. So `:root[data-theme="dark"] .astar.on` (index.html:11697), which this branch edits, and the `data-theme="light"` under system dark carve-out at index.html:2964, are untested. MEASURED: changing line 11697 to `color: #3a2a08` (an edge under 2:1 on dark) leaves the check at 144 PASS. The rule is correct today by reading; it is just unguarded.
Fix: add a `data-theme` arm (`addInitScript` setting `localStorage['kosmos-theme']` to `dark` with `colorScheme: 'light'`, and `light` with `colorScheme: 'dark'`), as mobile-shots.js already does.

### [WARNING] web/index.html:2965, forced-colors mode now paints the brand gold inside a system-colour outline
Before, the fill was `currentColor`, which forced-colors maps to ButtonText, so starred = solid system colour, unstarred = outline. Now the fill is a literal and forced-colors does not override it. MEASURED (chromium, `emulateMedia({ forcedColors: 'active' })`, standalone page with the branch CSS): starred path `fill=rgb(227,179,65)`, `stroke=rgb(0,0,0)`; the main-branch rule gives `fill=rgb(0,0,0)`. In a light high-contrast theme that is a 1.9:1 gold fill injected into a palette the person chose; the shape survives only by the 0.75px forced stroke. No forced-colors rule exists for the star (grep: only index.html:5554 and 12207 use forced-colors).
Fix: `@media (forced-colors: active) { .astar.on svg path { fill: currentColor; } }`.

### [WARNING] docs/browser-checks/mobile-shots.js:865 and 873, `after` ignores the PUT's answer, so a failed unstar leaves a starred agent behind silently
The harness does run `after` whatever `go` did (mobile-shots.js:3611, inside its own try; MEASURED by reading, and the only path that skips it is a LEAK GUARD throw, which stops the whole run). But `fetch` resolves on 400/403/500, and both `after` hooks discard the response, so a refused or failed unstar (the route answers 500 "we could not save that star", server.js:10723) throws nothing, flags nothing, and every later screen in the run is shot with `chatAgent` starred and sorted first. Same in `go` (a failed star is caught later by the waitForSelector timeout, so that side is fine).
Fix: return `r.status` from the evaluate and `throw new Error('could not unstar ' + name + ' after the shot (' + st + ')')` on non-200, as the throwaway-project helper at mobile-shots.js:203 does. A one-line `setStar(page, name, on)` helper would also remove the four copies of the same fetch.

### [NIT] web/index.html:2965, the trailing comment calls the old stroke "1.6px"
It was 1.6 user units, 1.2 CSS px at 18px; the new one is 0.75 CSS px (0.625 in the rail), not "1px" as the commit subject (3f61c3a4ac) and the brief say. Fix: "stroke-width is in the 24-unit viewBox: 1 is 0.75px at 18px and 0.63px in the 15px rail star".

### [NIT] web/index.html:2958-2962, the block comment says the light edge is "3.4 to 3.9:1 on every light tile, row and new-look ground"
True of the colour #9c741b, not of the rendered edge at 1x (see BLOCKER), and the check (3.68 to 4.26) does not include a new-look (`data-look="new"`) ground at all. Fix: say "the colour measures" and name what render-star-6719 actually covers, or add the new-look ground to the check.

### [NIT] docs/browser-checks/mobile-shots.js:858-860, the comment says "The first agent is starred"
It stars `data.chatAgent` (`ada` / `dana`), which then sorts first because it is starred. Fix: "data.chatAgent is starred (so it sorts first)".

### [NIT] docs/browser-checks/render-star-6719.js:287-288, the fill arm compares against the page's own --gold-bright
It proves the star uses the token, not that the token is the brightest gold; a later edit of `--gold-bright` itself passes. Acceptable as the ask is "the brightest gold that we have", but a pinned literal (`#e3b341`) alongside would make a token change a visible decision.

## What I checked
- Full diff `origin/main...HEAD` (3 files, +34/-10) read line by line.
- Every rule that can paint a starred star: `.astar` base and hover (2953-2957; hover is (0,2,0) and earlier than `.astar.on`, so a starred star keeps its gold on hover, REASONED from specificity and order), `.astar.on` light, the `prefers-color-scheme: dark` rule (2964), `:root[data-theme="dark"]` (11697), touch sizes (2972-2973), the consolidated rail (5634-5650: size only, 15px svg, no colour override), `prefers-contrast: more` blocks (354, 357, 11680: no star rule), `forced-colors` (5554, 12207: no star rule). `--gold-bright` is defined once (156) and not redefined in dark or new look.
- render-star-6719.js run on the branch: 144 PASS, 0 FAIL. Mutation controls (file copied to /tmp and back, tree confirmed clean after each): no edge stroke plus a broken forced-dark rule: still 144 PASS; fill back to currentColor: 142 PASS / 2 FAIL.
- Pixel measurement of the 18px and 15px star at 1x and 2x in chromium and webkit on white and the attn ground, with a no-dark-edge control that returns 0% everywhere (scratch script px.js / px2.js in my scratchpad).
- Forced-colors emulation in chromium on the branch rule vs main's.
- mobile-shots.js: the two new screens, the harness's go/verify/after sequencing (3560-3613), the stars PUT route (server.js:10712-10728) and engine/stars.js (no seeded stars, so unstar restores the start state). Ran the sanctioned command: 8 shots, 0 overflow, 0 errors, 0 skipped, into /tmp/r-7339; read the 1x desktop light shot's star pixels directly.
- web.label-contrast.test.js from the repo root: 7/7 pass. No unit test references `.astar`.
- `git status --porcelain` empty apart from this review file at the end.

## Author's response (Mona Lisa, 08:5x CDT)
- BLOCKER (the 1-unit edge at 1x never reaches 3:1): FIXED. The edge is 1.6 units on a 1x screen and 1 unit only at `min-resolution: 1.5dppx`.
- W1 (the check read the colour, not the stroke): FIXED, two ways.
  - It now reads the path's stroke and its width (`drawn`).
  - It adds a drawn-pixel check: a real screenshot of the starred star on a light tile at 1x and 2x, read back through a canvas. At least 80% of the outline must have a 3:1 pixel within one device pixel. The outermost pixel alone is always part-blended with the tile, so it cannot be the measure: a 1.6 edge scored 24% by it.
  - Two controls fail as they should: no edge scores 0%, and review 1's 1-unit edge at 1x scores 55 to 60%. The real star scores 100% at 1x and 2x in both engines.
- W2 (data-theme dark untested): FIXED. A `forced-dark` arm sets data-theme="dark" on a light system.
- W3 (forced colors): FIXED with `@media (forced-colors: active) { .astar.on svg path { fill: currentColor; } }`. Probed in Chromium: the fill becomes the system colour, as on main.
- W4 (after ignored the PUT answer): FIXED. Both PUTs throw on anything but 200.
- NITs: the CSS comment now gives widths in SVG units with px, and says the 3.4 to 3.9:1 is for the colour. The mobile-shots comment names data.chatAgent. The fill arm comparing to the page's own --gold-bright is KEPT: "the brightest gold we have" is defined by that token, so a later change to the token should carry through.
- render-star-6719: 170 PASS, 0 FAIL, chromium and webkit.
