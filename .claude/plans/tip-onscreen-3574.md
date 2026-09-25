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
render-help-tips-3574:
- T32: targets below and above the fold, and off to the left and the right, each wholly on screen with no arrow.
  An in-view control keeps its arrow and stays off its target.
- T32b: the real card on a 390px phone. The low target is a control (main handled it); the below-the-fold one is the
  case main got wrong.
- T32c: an 844x300 window. The card fits, Got it is in view, and its words scroll.
Measured controls:
- T32 below and above fail on origin/main's page.
- Removing the sideways terms fails the left and right arms.
- Removing .tip-bd's scroll rule fails T32c, and so does the old 80px floor.
T31 and every other arm still pass.

## Also fixed, found in review
- A card taller than the window: its words scroll inside it (.tip-bd), with the height measured by tipPlace from
  the real window. A CSS 100vh budget was rejected because it overstates a phone with its toolbar showing, and
  scrolling the whole card was rejected because it clips the arrow. The words are a tab stop, a labelled
  region, only while they scroll. They keep their scroll position when the card is placed again.
- T32c (844x300), T32d (360x300, plus scroll kept across a re-place) and T32e (a tall window: no scroll, no tab
  stop). Controls: without the measured height, T32c and T32d fail; without the scroll restore, T32d fails.
- The no-target card's 80px floor is clamped onto the screen.
- The "stay put" check uses the same on-screen test, slack included, so a phone card does not jump on scroll.
