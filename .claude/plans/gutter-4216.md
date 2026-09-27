# #4216: the Tasks white band reaches the window's right edge on classic-scrollbar machines

## Finished looks like
On a machine that draws classic scrollbars, the Tasks view (tab layout) reserves no scrollbar gutter, so the white
band from Group by down reaches the window's right edge (Josh's #3949 "both edges"). The header stays where it is.
render-tasks-view-3559 asserts it at the window's edge wherever a gutter can exist (the CI runner).

## Decided (the card's needs-decision, mine per Splinter)
- Drop the #1309 gutter on the Tasks view only, guarded like the talk view's (#3497: data-scrollbar-measured).
- Rejected: canvas = surface on Tasks (the strip moves beside the top band, still not "both edges"); a two-colour
  canvas gradient (a gutter paints the canvas COLOUR, not its image: measured and noted at the tip-dimming rule).
- Why the header does not move: its padding is 3 x space-8 + scrollbar width - (100vw - 100%), which counts whatever
  the page gives up, gutter or real scrollbar.
- Weakest premise: the cost. On a classic-scrollbar machine the Tasks content shifts 15px the moment the list grows
  long enough to scroll (the #1309 shift, now within this one view). The header does not.
- This Mac draws overlay scrollbars (headless and headed, measured), so the arm is proven where CI draws classic ones;
  here it reports not applicable.
