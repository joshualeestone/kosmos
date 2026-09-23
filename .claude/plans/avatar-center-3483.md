# #3483: center the generated avatar initial vertically

Card: joshualeestone/kosmos#3483. Josh (0.6.88 Windows build, via Homer): the single
first-name letter in the generated circular avatar (the initial shown when there is no
image) "sits slightly too high". Minor/cosmetic.

## The fix
`web/index.html`, function `face(a)`, the no-image branch: the initial was an SVG
`<text x="36" y="41" text-anchor="middle" class="avatar-initials">` inside a
`<circle cx="36" cy="36" r="23">`. The hardcoded `y="41"` baseline put the cap letter's
visual centre at ~33.5 (above the circle centre 36). Changed to `y="36"
dominant-baseline="central"` so the letter's em-box centres on the circle centre.

## Verification
- Headless (pw-runtime): the initial's rendered bbox centre is now exactly 36.00
  (offset 0); the old baseline measured ~33.5 (too high).
- Node regression guard: `web.not-running.test.js` "#3483: the no-image avatar initial
  is vertically centered on its circle" (lifts the real `face()`), reds on a revert to
  `y="41"`.
- Gates: browser-check surface gate (#2518) clean (no mapped token); coarse gate (#1720)
  satisfied via a `Browser-check:` trailer.

## Scope / decisions
- Only the SVG `face()` initials `<text>` is changed. The `.lav` CSS-span avatars (list
  tint) centre via a different, already-correct mechanism and are untouched.
- `dominant-baseline="central"` is well-supported in the two engines Kosmos meets
  (WebKit/Chromium). Weakest premise: that `central` (em-box centre) reads as centred for
  UPPERCASE initials -- measured, it does (offset 0), so not shipped on theory.
