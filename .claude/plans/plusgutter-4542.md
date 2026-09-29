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

## Review iteration 1 (blind)
BLOCKER: the #2518 surface gate names render-plus-blue-1615 (plus-active) and render-help-tips-3574 (tip-dimming): both ran alone
clean and carry per-check trailers. WARNING: a root with its own colour stops the body's gradient reaching the canvas, so a short
Plus page in a tall window would get a flat band: the body is at least the window tall under the same guards (tip-dimming's
shape), with a G5 arm and a control (my first G5 sampled where the gradient equals its outer stop, so the control could not tell;
it now samples just below the page's natural bottom, with a precondition). NITs: G1 requires overflow; G4 proves the control style
is gone; the comment names the consolidated guard; claims narrowed to what was measured.

## Review iteration 2 (blind): CONVERGED (nothing at BLOCKER or WARNING)
The min-height rule changes no layout it should not (state 2's --plus-avail already exceeds it; fixed layers and dialogs resolve
against the viewport; mobile, overlay-scrollbar Macs and the consolidated layout are excluded by the guards; it and tip-dimming's
identical rule are mutually exclusive). NITs taken: the #4506 note is advice, not a rule that exists; G1's reason reworded.
ACCEPTED: 100vh counts a horizontal scrollbar, as tip-dimming's rule does; nothing on Plus overflows sideways.

