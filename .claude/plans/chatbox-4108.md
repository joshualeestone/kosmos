# chatbox-4108: render-chatbox-phone-4108 red on main since #7196

Card: kosmos#7196 (follow-up, Renet's bisect in comment 6435001751; Splinter routed it as a priority, 10-27 01:05).
The check is in docs/browser-checks/gated.txt, so it blocks the 0.7.71 cut and reds any web PR that selects it.

## Finished looks like

render-chatbox-phone-4108 passes on main (the gate's Chromium run, and both engines by hand), still judging everything
the person sees, and the question of whether the tour's make-room code is now dead is on its own card.

## Cause

The check required, at ordinary text size, that the project tip scrolled the page to make room for its Conversation
step ("the fix ran"). #7196 (9f62cd78a6, pjFitRoomPhone) fits the room's thread above its composer, which gives that
room back. Measured 10-27 on this branch: no case walked makes room any more (Chromium 360, 375 and 375 at text x1.3;
WebKit 360 and 375), and no step of the agent page's tip or the board tour does either (25 steps). What the person
sees still passes everywhere: each step points at its area, fully on screen, and only the Conversation step may scroll.

## Steps

1. The must-have-made-room line is reported, not judged (a MEASURE line per case and a summary). The per-step checks
   stay: wherever the page does make room, that card must point fully on screen.
2. Verify: the check passes in the gate's default (Chromium) and with ENGINES=chromium,webkit.
3. File a card: the tour's make-room code is unused at every size the check walks; decide whether it can go.

## Decided

- Tried first and dropped: an aggregate line (the page made room in at least one case walked). Measured, it fails in
  both engines, because no case makes room at all, and the gate runs Chromium only, so it could never have held.
- Not deleting the make-room code here: it is shared tour code, this change unblocks a release, and sizes the check does
  not walk (a smaller phone, larger text) may still need it. That is the separate card.
- Weakest premise: that the make-room path matters only as dead code now. If a size the check does not walk needs it and
  it breaks, nothing here would say so; the per-step checks only cover the sizes walked.
