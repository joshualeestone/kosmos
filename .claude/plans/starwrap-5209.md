# starwrap-5209: the star field's resize keeps a wrapped dot inside its wrap band

Card: joshualeestone/kosmos#5209 (found in #5189's challenge loop). Not day-one; cosmetic.

## Problem
`plusStarsResize` scaled every dot by the growth factor, including a dot sitting in the 4px wrap margin
past an edge. A dot at y = -3.7 grown by 1.63 landed at -6.0, past the -4 wrap line, so the draw wrapped
it to the far edge early. (Review 2: that dot is off the canvas either side, so this was never a
visible flash; the card's "flash" wording is not backed.)

## Decision
`plusStarScale(v, o, n)`: inside the box, scale as before; before the start edge (v < 0), keep v; past
the end edge (v > o), keep the offset past the new edge (n + (v - o)). Both axes. A dot in the margin can
then never cross the wrap line by a resize.

Rejected: re-wrapping after scaling (moves the dot to the other edge, the same visible jump the card
names). Rejected: scaling only in-box dots and dropping the rest (changes the field's count).

## Tests
`web.plus-stars-wrap-5209.test.js`: the card's own case (-3.7 grown x1.63 stays at -3.7), past-the-bottom
offset kept growing and shrinking, in-box scaling unchanged, and plusStarsResize uses the helper on both
axes. Sabotage (helper back to v * n / o) turns two rows red. 336 page-reading and repo-wide test files:
3061 pass, 0 fail.

## Weakest premise
Not checked in a browser: the render check (render-plus-stars-3778) was not run (shared browser queue);
the change is a pure function and its single call site.
