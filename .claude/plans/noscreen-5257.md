# noscreen-5257: a test for the project page's Windows "No screen to show" state (#5257; after Monday)

**Finished means:** a regression in the project page's no-window branch (#5249 / #5223) fails a test: the label
"No screen to show", the engine's sentence via pjSentence, no "We cannot see its screen right now." lead.

## Change
- web/index.html: the "Its screen" block moved, unchanged, out of paintThread into pjPaintScreen(body, name);
  paintThread calls it with the same arguments.
- web.pj-screen-5257.test.js: lifts the real pjPaintScreen + pjSentence and runs them on a fake document with only
  the three element ids the block writes (any other id throws): the Windows state; CONTROLs for a failed read on a
  Mac, a non-boolean noWindow, no viewport, and a captured screen under the member's name; paintThread wiring.

## Decided
- The card's second option (a page-function unit test) over restoring the browser-check arm: the arm needed a live
  project thread the CI fixture cannot serve, which is why #5249 dropped it.
- A small move of the block into its own function rather than lifting all of paintThread (which reads most of the
  page): the move is the smallest thing that makes the real code runnable.

## Weakest premise
That the move is behaviour-neutral in a browser: render-thread.js already reads #pj-screen-label and #pj-screen-hint;
a full browser-check run on the exact head comes before the after-Monday merge.

## Tests
New file 4/4; mutant (the Windows label branch removed) turns it red. Every web.* test + guards: 2481/2481.
Browser-check coarse and surface gates pass (Browser-check trailer).
