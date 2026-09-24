# talk-narrow-fill: the narrow-width Talk box is usable (follow-up to #3497)

## Problem (found in #3497's review, pre-existing since #2622)
Below 56rem the identity block and nav (~400px) stack above the Talk box, but the panel kept a
window-tall fixed height, so the box got the sliver left under the nav: 67px tall at 800x900 with
the composer below the window, 44px at 800x600. Nobody could type at narrow width without the
composer sitting off screen.

## Decision
At narrow width the page scrolls normally (panel height auto) and the Talk box is its own
window-tall block (100vh minus 48px, floor 320px) below the nav. Scrolled to, the thread and the
composer fit the window.

## Rejected
- Shrinking or collapsing the nav at narrow width: a layout change to the nav Josh just approved
  (#3500 2x2 pack), out of scope for a bug fix.
- Keeping the fixed panel and giving the box a min-height: the panel would overflow its own fixed
  height and the page scroll would be accidental rather than designed.

## Weakest premise
That scrolling to the box is acceptable at narrow width. It is the same pattern as every other
stacked narrow section; the wide layout (where Josh works) is unchanged.

## Verification
render-talk-fill-2622: A2b (box a usable, window-fitting height) and A2d (scrolled to, the composer
is inside the box and on screen) replace the old A2b lower bound. Control: against origin/main both
red (box 67px, composer below the box and the window).
