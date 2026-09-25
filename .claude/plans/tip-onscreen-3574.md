# #3574 follow-up: a help tip's card stays wholly on screen

Liu Kang, 2026-09-25 01:26: on a phone the project tip's target (#pj-add-member) moves below the composer (Kano's
mobile-rooms-718), and tipPlace "never checks the bottom edge".

## Finished looks like
Wherever a tip's target sits (in view, below the fold, above it), the card is wholly inside the window. A target in
view keeps its arrow. A target out of view gets a flat card with no arrow, and the scroll listener (tipRelayout)
places it again once the target is visible.

## Decided
- Measured the claim before building. "below" and the fallback did check the bottom, but "above" checked only its top
  and "below" only its bottom. So a target below the fold put the card below it, and one above the fold put it
  above. Main measured: top 968 on an 860 window, and -358.
- Off screen means no pointing places at all. The side places clamp their top onto the screen and would otherwise
  point at nothing.
- The tip copy (Members, Conversation, Files) stays the same across widths. It is anchored on Members, which is
  where the card points, and the phone reorder is not on main. Rejected: renumbering now, for a layout that
  does not exist yet.

## Weakest premise
That a flat card near the edge is better than scrolling the target into view. Scrolling moves the page under the
person on first visit, which is worse.

## Verification
render-help-tips-3574 T32: target below and above the fold, plus an in-view control. It fails on origin/main's page
(measured) and passes with the fix. T31 and every other arm still pass.
