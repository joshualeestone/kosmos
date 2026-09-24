# talk-narrow-fill: the narrow-width Talk box is usable (follow-up to #3497)

## Problem (found in #3497's review, pre-existing since #2622)
Below 56rem the identity block and nav (~400px) stack above the Talk box, but the panel kept a
window-tall fixed height, so the box got the sliver left under the nav: 67px tall at 800x900 with
the composer below the window, 44px at 800x600. Nobody could type at narrow width without the
composer sitting off screen.

## Decision
At narrow width the page scrolls normally (panel height auto) and the Talk box is its own
window-tall block (100vh minus 48px, floor 320px) below the nav. The header is not sticky in this
view, so it scrolls away and never covers the top of the box whatever its height; the body's bottom
padding matches the 24px gap so the box sits evenly at the end of the page. The inert
`grid-template-rows` rule (it only mattered with a definite panel height) and the A2c arm that
guarded it are removed.

## Rejected
- Sizing the box around a sticky header: the header's height changes with notices and breakpoints,
  and nothing in CSS can read it (scroll-padding-top carries extra notice room); a JS observer was
  already declined in #2622.
- Container-query units on a scrolling panel: support in the app's WebKit is not certain.
- Shrinking or collapsing the nav at narrow width: a layout change to the nav Josh just approved
  (#3500 2x2 pack), out of scope for a bug fix.
- Keeping the fixed panel and giving the box a min-height: the panel would overflow its own fixed
  height and the page scroll would be accidental rather than designed.

## Weakest premise
That the static header is the right trade at narrow width: while typing there, a header notice
(offline, update) is scrolled off screen; scrolling up shows it. The alternative, a box sized around
a sticky header of variable height, is not expressible in CSS. The wide layout (where Josh works)
keeps its sticky header. The page's scroll-padding-top (which cleared the sticky header) is zeroed in
this view, or focusing the box would push its composer off screen.

## Verification
render-talk-fill-2622: A2b (usable, window-fitting height), A2d (scrolled to the box, all of it is
on screen and below the header) and A2e (same at the end of the page) replace the old A2b lower
bound and A2c. Control: against origin/main A2b/A2d/A2e red (box 67px, composer below the box and
the window); against the first sticky-header version A2d red (box top 48 under the header).
A2f: focusing the box keeps the composer on screen (it landed at 1017 in a 900 window with the
scroll padding left in place), and the build marker stays clear of the box.
