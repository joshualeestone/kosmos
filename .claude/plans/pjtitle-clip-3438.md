# Plan: project-detail title clips descenders (#3438)

## Problem (Josh, 2026-09-22, #chaoskosmos-design + card #3438)
On the Projects consolidated project-detail view the big title (`#pj-one-name`, class `.dname`)
clips its descenders: the "g" in "Sourcing" is cut off at the bottom. Josh reported it live with a
screenshot.

## Cause (measured)
`.pjtitle #pj-one-name` (web/index.html) has `overflow: hidden` (kept for the one-line width
ellipsis, #2838) over a line-box that inherits the same height as the font. Measured in the
consolidated view: font 20px, line-height 20px (ratio 1.0), so the glyph descenders that extend
below the baseline within the em are clipped by the overflow. This is the same class of bug as
#3415 on the agent name, which was fixed by giving the clipped element a proportional line-height.

## Decision
Give `.pjtitle #pj-one-name` a unitless `line-height: 1.2`, mirroring the #3415 fix. Unitless so it
tracks the size across the layout variants (1.25rem consolidated, 1.375rem elsewhere). This raises
the line-box to 24px for the 20px font, clearing the descenders, while KEEPING `overflow: hidden` +
`white-space: nowrap` so a long title still truncates with an ellipsis (no regression of #1303 /
#2838).

- Rejected: removing `overflow: hidden`. That would restore descenders but lose the one-line width
  ellipsis a long title needs.
- Rejected: padding-bottom. It would grow the header box rather than the line-box, and interacts
  badly with the flex row's `align-items: center`.

## Verification
`docs/browser-checks/render-title-descender-3438.js` renders the real consolidated project-detail
view for a descender-named project and asserts the computed line-height is at least 1.15x the font
size, with `overflow: hidden` and `nowrap` preserved. Red-capable: measured FAIL on the pre-fix page
(ratio 1.0) and PASS on the fixed page (ratio 1.2). A before/after screenshot was sent to Josh.

## Weakest premise
That 1.2 is enough headroom for every font and weight the title uses. Measured sufficient at 1.25rem
(the consolidated size); the same ratio clears the larger 1.375rem variant because it scales with the
font. Reversible in one line if a heavier face ever needs more.

Addresses #3438
