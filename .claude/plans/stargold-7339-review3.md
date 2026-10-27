# stargold-7339, blind review 3 (final round, whole branch)

Branch `stargold-7339` vs `origin/main` (5 commits, 08e2db7b87..eae9f282be; main is 6 commits ahead, none of them touch `.astar`, `--gold-bright` or the two check files). Every line of `web/index.html`, `docs/browser-checks/render-star-6719.js` and `docs/browser-checks/mobile-shots.js` in the diff was read as new. Reviews 1 and 2 were read only after the findings below were measured.

Counts: 0 BLOCKER, 3 WARNING, 4 NIT.

The CSS does what the brief says, in every place a starred star renders, and the check passes on it (212 PASS, 0 FAIL, both engines). The warnings are about what the check can and cannot see, and about what Josh will see at 1x.

## Findings

### [WARNING] docs/browser-checks/render-star-6719.js:315, 352, 354, 360: the pixel arm can skip a star silently, so it can pass with stars it never measured

`scoreStar` returns null when the screenshot throws (`.catch(() => null)`), and the loop then does `if (!r || !r.outline) continue;`. The hover is `.hover().catch(() => {})`. The assert is `measured >= 6`, not "every star, both states". The fixture has 6 stars per arm (12 measurements), so up to 6 of them can be lost and the line still reads "every starred star, at rest and hovered ... measured 6; none under". Concrete ways to lose one: a star that is hidden, zero-size or detached by a repaint (screenshot times out, null, skipped); a star painted over by a uniform overlay (outline 0, skipped); a hover that cannot land (swallowed, so the "hovered" sample is really the rest state, labelled hovered). The first two are exactly "a star a person cannot see", and the arm passes them.

MEASURED that it does not happen today: in a scratch probe using the check's own `open()`, hover lands on all 6 grid stars in both engines at 1x and 2x (computed colour goes from rgb(156,116,27) to rgb(125,92,19) and `:hover` matches), and the branch run reports `measured 12` on every arm. REASONED that it can: the skip and the `>= 6` floor are in the code as quoted.

Fix: `chk(measured === sel.length * 2 && fails.length === 0, ...)`, push a failure instead of `continue` when `!r` or `!r.outline`, and after the hover assert it took, for example `await page.evaluate((k) => document.querySelector('[data-px="' + k + '"]').matches(':hover'), k)`.

### [WARNING] web/index.html:2965-2969 with ~/work/design-shots/kosmos-7339: at 1x the "brightest gold" is under a fifth of the star, and every design shot is 1x

The 1.5px edge is centred on the path, so on the 18px star it covers most of the shape at 1x. MEASURED, chromium, light, first grid star, branch CSS, star pixels that are within 30 levels of --gold-bright (227,179,65):

| | star pixels | bright | share | mean colour of the star |
|---|---|---|---|---|
| 1x | 109 | 20 | 0.18 | (191,154,71) |
| 2x (.75px edge) | 345 | 152 | 0.44 | (204,165,74) |
| design shot, desktop light, working tile | 110 | 20 | 0.18 | (188,153,70) |

The old starred star was solid #9c741b (156,116,27). So at 1x the star is clearly brighter than before, but its average is still about halfway between the old gold and the one Josh asked for. Zoomed, the 1x star reads as a dark gold rim around a small bright centre. On a 2x screen it is much closer to the ask. All 8 shots in ~/work/design-shots/kosmos-7339 are 1x (the desktop ones are 1280x800, the phone ones 393x852), so the version Josh is shown is the dimmest one, and he may answer "still dingy" about a star that looks right on his own screen, or the reverse.

Fix: add 2x shots of the same two screens to the design folder (the shot tool takes a scale), and put both in front of Josh with one line saying which his screen shows. Optional, if the 1x star still reads dim to him: `paint-order: stroke` with a doubled width keeps the visible rim the same and lets the fill cover the inner half of the line. MEASURED in a scratch copy: bright share 0.31 at 1x and 0.51 at 2x, but the star also grows (156 star pixels at 1x against 109), and I did not run the 3:1 measure on it, so it is a candidate, not a fix.

### [WARNING] docs/browser-checks/render-star-6719.js:307-309: the comment says the arm photographs working tiles and reads the ground 1px around the icon; it does neither

1. "on its own tile or row (plain, working, needs-you)": the fixture (lines 66-79) has no working agent. The grounds the arm actually reports are `acard`/`lrow.off.notrunning`, `attn` and `attn.notrunning.needstrust`. MEASURED in a scratch probe that sets two fixture agents to `running: true, state: 'working'`: every working tile and rail row passes, at rest and hovered, 1x/1.5x/2x, both engines (lowest share 0.91, chromium 1.5x grid). So the CSS is fine, but the green wash ground is never photographed by the shipped check, and the comment says it is.
2. "The ground is read inside the star's own button (1px around the icon)": `loc.screenshot({ padding: 1 })` passes an option Playwright does not have. MEASURED on playwright-core 1.62.1: the locator screenshot options are animations, caret, mask, maskColor, omitBackground, path, quality, scale, signal, style, timeout, type, and the PNG is the same size with and without `padding: 1` (19x18 at 1x, 38x36 at 2x, both engines). The ground is the svg box's own top-left pixel. That pixel is still inside the button (the rail's svg corner is about 3.5px inside the 6px corner radius), so the outcome holds, but the stated mechanism is not what runs. This was review 2's W2; the fix recorded for it is this no-op option.

Fix: add a working agent to the pixel arm's fixture (or flip one in the arm, as the probe did) so the wash ground is measured; drop `{ padding: 1 }` and say "the ground is the svg box's corner pixel, inside the star's button, so a hover tint is the reference".

### [NIT] docs/browser-checks/render-star-6719.js:21: the header still lists only the old contrast arm

Review 2 raised this and the author's response says the NITs were fixed, but line 21 is unchanged. The file now also checks the --gold-bright fill, the drawn stroke, the drawn-pixel edge at 1x/1.5x/2x in grid and rail with two controls, the dark edge on both dark paths, the 2x width, and forced colors. Fix: add those to the header.

### [NIT] docs/browser-checks/render-star-6719.js:270-274 and 381-385: the in-app Dark arm is still called `forced-dark`

The author's response says it was renamed; the label changed to "edge colour", but the theme key is still `forced-dark`, so the log prints "[chromium forced-dark edge colour]" four lines above "[chromium forced colors]", which is the high-contrast arm. Fix: `app-dark`.

### [NIT] the hover darkening is guarded by one arm only, and only just

MEASURED mutation control (page copied to my scratchpad, check run with KOSMOS_PAGE, worktree untouched): with `.astar.on:hover { color: #7d5c13; }` removed, the run is 211 PASS, 1 FAIL, the only red being chromium 1x rail, needs-you rows hovered, 0.77 against the 0.80 bar. WebKit and every other density stay green. So the assert can go red on what it guards, but by 0.03. Fine as it is; worth knowing before anyone moves the 0.80 bar or the hover tint. No change needed unless the bar moves.

### [NIT] docs/browser-checks/mobile-shots.js:862-875: the same 1-line star PUT is written out four times

Each copy builds the fetch, checks 200 and throws. A local `starAs(page, name, on)` would make the two screens four short lines and keep the error text in one place. Behaviour is correct (the harness runs `after` whatever `go` did, mobile-shots.js:3611-3614).

## What I checked

- Full diff `origin/main...HEAD`, three code files, line by line. Every `.astar` rule in web/index.html (2953-2979, 5640-5656, 11703); the only renderer, `starBtn` (39831), and its six callers (three tile paths, three list-row paths). No other theme, look or layout sets `.astar` colour: `data-look="new"` and `body.plus-active` change only grounds; `.lrow.off` dims the name, not the star (4158); no opacity or filter on `.acard`/`.lrow`; no transform or zoom on any star ancestor except `.lname .astar`'s translateY.
- Specificity: `.astar.on:hover` (0,3,0) beats `.astar:hover` (0,2,0); both dark paths, (0,5,0) and (0,4,0), beat it. `node tools/sync-forced-theme.js --check` rc 0, so the 11703 mirror is the generated one.
- Touch: the `pointer: coarse` rules change only button size, padding and the rail's invisible `::after` hit area; the svg stays 18px (tile, list) and 15px (rail), so the drawn star is the one the pixel arm measures. REASONED: sticky hover after a tap leaves the darker edge and the tint showing, which is the hover state, not a defect.
- Focus-visible: unchanged outline on the button (2px var(--label), offset 1px), clear of the edge; a focused, unhovered star keeps the rest edge. REASONED, not photographed.
- `vector-effect: non-scaling-stroke` under `translateY(-50%)`: MEASURED by the rail arm (the rail star carries that transform) passing at 1x/1.5x/2x in both engines, and by mutation: with `vector-effect` removed (icon-space 1.5 units), the rail arm goes red in chromium 1x and 2x and webkit 1x (209 PASS, 3 FAIL). Translation does not scale, so it cannot change the width.
- Hover legibility: #9c741b to #7d5c13 is a 1.46:1 step, arriving with the grey tint, the same direction as the unstarred star's hover (ink-2 to ink). Reads as part of hover, not a flicker. Dark has no edge change on hover (fill and edge are both --gold-bright, 5.8:1 and up), only the tint.
- render-star-6719.js on the branch, both engines: 212 PASS, 0 FAIL, rc 0. Controls: no edge 0.00, 1-unit icon-space edge 0.60 (chromium) and 0.55 (webkit).
- Mutation controls via KOSMOS_PAGE copies in my scratchpad: hover rule removed (1 red, above); vector-effect removed (3 red, above). REASONED for the rest, by reading the asserts: dark edge back to --gold-deep fails the string-equal "edge is --gold-bright"; the 2dppx rule removed fails `w === '0.75px'`; the forced-colors rule removed leaves fill at rgb(227,179,65) against the button colour.
- Scratch probes using the check's own `open()` and `scoreStar()`: screenshot sizes with and without `padding`; hover taking on every grid star; working tiles and rows at three densities; bright-fill share at 1x and 2x and the `paint-order` candidate.
- Design shots in ~/work/design-shots/kosmos-7339 viewed (desktop light grid, phone light grid) and the starred star zoomed at 8x, light and dark.
- web.label-contrast.test.js and web.gold-edge-1044.test.js from the repo root: 14 pass, 0 fail. No unit test references `.astar`.
- Not run: the check on the CI runner; a 3x pixel arm (phones). REASONED for 3x: .75px is 2.25 device pixels there, thicker than the 2x case that passes.
- `git status --porcelain`: only this review file.

## Author's response (Mona Lisa, 09:0x CDT)
- W1 (unmeasured stars pass): FIXED. A star that cannot be photographed, or a hover that does not land (checked with `:hover`), is a failure. The assert needs measured === stars x 2. Still 212 PASS, 12 of 12 measured per arm.
- W2 (1x shows the dimmest version): ADDRESSED with 2x shots (desktop2x, iPhone at device scale) beside the 1x ones. Josh's Mac and iPhone are 2x and 3x. paint-order: stroke is REJECTED: it halves the visible edge, which is the failure reviews 1 and 2 measured.
- W3 (comment): FIXED. It names the grounds the sample data has (no working agent), drops the no-op padding, and says the reference is the icon's corner pixel.
- NITs: the header lists the #7339 checks. `forced-dark` is renamed `in-app-dark`. The hover rule is guarded by one arm at 0.77, which I accept: that arm is the real case it exists for. The repeated PUT in mobile-shots stays as it is, because each copy names its own error.
