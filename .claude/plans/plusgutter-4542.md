# plusgutter-4542: no white strip beside the navy Kosmos Plus page on classic-scrollbar machines

Card: kosmos#4542 (found while building #4506). On a machine that draws classic scrollbars, Settings > Kosmos Plus showed a
pure white 15px strip down the whole right edge beside a navy page (measured 255,255,255 beside 12,21,41).

## Why
The tab layout reserves a scrollbar gutter on <html> (#1309). A gutter paints the canvas's COLOUR only. body.plus-active
paints its navy as a radial-gradient IMAGE and sets its tokens on the body, so the canvas has no colour and the gutter is white.

## Call (the card's option 1)
One rule beside #4216's (the same fix for the Tasks view), with the same guards (classic scrollbars only, not the consolidated
layout, not while the tour dims): while body.plus-active, the canvas is #0b1428, the gradient's OUTER stop, so the strip reads
as the gradient's own edge. The card named the weakness, a second copy of a colour: web.plus-gutter-4542.test.js pins the rule's
colour to the gradient's last stop, so the two cannot drift.

## Rejected
- Option 2, dropping the gutter on Plus: a 15px jump into the section, what #1309 exists to prevent (as #4216 rejected).
- Option 3, moving the Plus tokens to a rule the root sees: the largest change, for the same pixels. It would also make #4506's
  dialog gutter exact; that is #4506's to take if it wants it.

## Proof
docs/browser-checks/render-plus-gutter-4542.js: the real board by the real route (?tab=settings&sec=plus), Chromium with
classic scrollbars; the gutter read as pixels top to bottom in a light and a dark OS setting; a CONTROL takes the canvas colour
away and must read white (the reported bug), so the check can go red.

## Weakest premise
Measured in headless Chromium with a forced classic scrollbar, as the card was; not on a real Windows PC or a Mac with a mouse.
