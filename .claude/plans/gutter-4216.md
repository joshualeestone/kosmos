# #4216: the Tasks white band meets the window's edge on classic-scrollbar machines

## Finished looks like
On the Tasks view (tab layout), the canvas, which is what a reserved scrollbar gutter shows, is the surface colour, so
the white band from Group by down meets the window's right edge on a machine that draws classic scrollbars (Josh's
#3949 "both edges"). Nothing moves: the gutter stays reserved. render-tasks-view-3559 pins the canvas colour, and the
top band's own edge reads prove the body still paints the ground over its box.

## Decided (the card's needs-decision, mine per Splinter)
- Canvas = surface on Tasks (the card's option 2).
- Rejected, after review round 1: dropping the gutter on Tasks (first built). It moves the fixed assistant bubble,
  chat and nudge 15px between tabs, and shifts the list while filtering or typing a search, the jump #1309 exists
  to prevent, which Josh raised himself ("kicks the page over"). A still strip is better than motion he rejected.
- Rejected: a two-colour canvas gradient. A gutter paints the canvas colour, not its image (measured, noted at the
  tip-dimming rule).
- Not while the tour dims: its rules own the canvas then.
- Weakest premise: a 15px strip remains beside the short top band on classic-scrollbar machines (the surface
  beside the ground: 255 vs 250,249,247 light, 23,25,28 vs 12,13,15 dark). If Josh sees it, the only remaining
  fix is layout motion, which is worse.
- CI draws no scrollbar width (macOS headless hides them; review round 1 measured it), so the arm asserts the
  computed canvas colour, which holds on any machine, rather than a gutter pixel that never exists there.
