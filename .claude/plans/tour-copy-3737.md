# #3737 tour and tips (Josh 0.6.94, 2026-09-25 08:51)

Josh, verbatim: tour step "Your agents" body "Access all your agents to see what they are working on and talk to them
directly."; "Projects" body "Create projects for your agents to work on together."; "Your settings" becomes Head "Your
Profile", Body "Access all your Kosmos settings here."; fix the dim's white triangle bottom-left (and, per the card, the
strip on the right edge in steps 2 and 4); move the ring tip to the view-agent screen, Head "Your agent's memory", body
"The ring shows how full your agent's memory is. [three dots] This is normal and the agent will automatically write
themselves a handoff, You can also manage their memory under AI settings."

## Finished looks like
The tour reads his words at steps 2 to 4. The dim covers the whole window at every step in the app's engine (WebKit),
corners and scrollbar gutter included. The ring tip shows by itself on an agent's own page, beside her ring with its
arrow, after that page's own tip, and never by itself on the board; the ? still opens it anywhere. The guide agent's
description of the ring uses the same words.

## Decided
- Body starts at "The ring shows": his first body line repeated the head (Splinter's reading on the card).
- "You" after the comma kept as he wrote it (his copy is verbatim).
- The ring tip shows after the agent page's own tip (TIPS order). Rejected: ring first, which would greet someone on a
  new page with a detail before the page itself.
- It shows only when her page draws a ring (a known memory reading). An agent with unknown memory has no ring there, so
  nothing to point at; the ? still explains it.
- The dim is its own full-window layer with the ring's shape cut out (clip-path, evenodd). The old dim was the ring's
  100vmax box-shadow; WebKit rounds a spread shadow at radius plus spread, so a ring near one corner left the far
  corner bright (reproduced in WebKit, not in Chromium, which shrinks that corner).
- The gutter: a fixed layer cannot paint the reserved scrollbar gutter (scrollbar-gutter: stable in the tab layout),
  so while the tour dims, the page canvas takes the body's ground mixed with the dim as ONE colour (tipDimmedGround,
  cached by the look), and the body fills the window so that dimmed canvas shows only in the gutter. One colour, not a
  gradient over the ground: a gutter paints the canvas's colour and not its image. Measured 2026-09-25 11:25, when this
  Mac began reserving a real 15px gutter in Chromium (classic scrollbars): the gradient version left a bright strip
  there, T33's corner pixel red, on the code from before this branch's latest commits too.
- tipPlace: a side card may slide up or down while its arrow can still point at the target's middle, tried only after
  the usual four places, so an agent's crowded page keeps an arrow and other tips are unchanged where a usual place
  was clear.
- The guide's instructions (engine/roles.js) quote the ring tip, and roles.test keeps them in step; updated to the new
  words.

## Weakest premise
The gutter is reproduced in Chromium only. WebKit here still draws overlay scrollbars (no gutter), so the app's own
engine with a mouse attached is reasoned: it paints the gutter from the same canvas colour. T33 reads that colour per
look (light rgb(186, 185, 185), Kosmos+ navy rgb(19, 30, 53)) in both engines, and Chromium's corner pixel reads a real
gutter. Control: with the one-colour rule removed, T33's Chromium corner pixel and both engines' colour arms fail.
Whether an engine reserves a gutter depends on the machine (a mouse attached), so on a trackpad-only machine the corner
pixel arm reads the fixed shade instead; the colour arms still catch the regression.

## Verification
render-help-tips-3574: T2 (his words at steps 2 to 4), T3 (board shows the Agents tip, not the ring; her page shows
its tip then the ring, beside it with an arrow, in his words, three gauge colours, announced), T16 (leaving her page
closes it unrecorded, and no tip shows; coming back shows it), T3c (unknown memory: no ring on her page, no tip), T24/T28 (the board's first screen tip is now the Agents tip), T33 in
Chromium and WebKit (all four steps dim the window's corners; the gutter dims; CONTROL: closed, the same pixels are
bright). Negative control: with the old shadow dim, T33 fails in WebKit. roles.test passes.
