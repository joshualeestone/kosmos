# reland-4108: the 48px phone chat boxes, with a project tip that still points on a phone

kosmos#4108, for 0.7.03 (Liu Kang m1411, m1422, m1517). #4131 made the agent and project-room chat boxes 48px tall on a
phone. On main it turned render-room-msgbox-2806 red (the only red in about 6,150 passes), and Baron reverted it for
0.7.01 (#4162, 32fc398a2). This re-lands it with the tip fixed; the check was not relaxed.

## Cause (measured, not reasoned)
Instrumented tipPlace on main-with-#4131 at 375x800: the Conversation step's target (`#panel-projects .pj3 > .pjmid`)
sits bottom-aligned with its top at 168px. The card is 146px tall and needs its 12px arrow gap and tipPlace's 12px pad
above it, so "above" needs the top at 170 or more. It was 2px short; below, beside and left do not fit either, so the
card fell back to the arrowless "flat" card. At 800 wide it fits (it points down from above).

## Done looks like
At 360 and 375, in Chromium and WebKit, and at 375 with Android's larger text (x1.3), every step of the project tip
points at its area with the whole card on screen; the four chat boxes are 48px on a phone and unchanged on desktop;
render-room-msgbox-2806 and every render-room-* check pass in both engines.

## Change
- Commit 1 reverts 32fc398a2, bringing back #4131's CSS, render-chatbox-phone-4108, its gated.txt line, README row and
  reason-grep count, and the render-dm-chatfirst-718 comment. Baron's revert plan and proof files are kept.
- Commit 2, web/index.html tipTourRender: after placing a step's card, if it came out `flat` and the step's area is on
  screen with its top closer than the card needs (card + 12 gap + 12 pad + 4 slack), scroll up by exactly the shortfall
  and place it again. tipPlace re-measures the area (Liu Kang's guard 1). A card that found a pointing place is never
  moved, so every screen that already worked is unchanged.
- Named once and shared: TIP_GAP and TIP_PAD (tipPlace's spacing) and TIP_ROOM_SLACK; one tipTarget (the first SHOWING
  match for a selector) used by tipPlace, the make-room step and tipLayout's ring, so all three measure the same element.
- The make-room step scrolls only when the window can take the whole shortfall (a part-way scroll would still leave it
  flat), and only once as the step opens (never on a later relayout: it would fight the person's own scrolling).
- render-chatbox-phone-4108.js walks the project tip at 360 and 375 in both engines and at 375 with 1.3x text, asserts
  the page made room for the Conversation step there and scrolled for no other step, and walks the agent-page tip and
  the board tour at the same sizes (judged only where the page made room; measured: they point at every step and the
  page never scrolled for them).

## Rejected
- Shaving 2px somewhere else in the room layout: it restores a 6px margin that the next pixel of layout takes away.
  Liu Kang: a general "make room, then place" beats that.
- Relaxing 2806's tip arm: it caught a real regression.

## Weakest part
The 4px slack is empirical. Without it the card still failed by a fraction of a pixel (the area's top is fractional),
and it is not derived from a rounding rule. It is small and only applies when the card would otherwise be flat.
Also, the x1.3 text case points even WITHOUT the fix (the larger text changes the layout so there is room): it is a
guard against a future break, not a reproduction of this one.

## What would change my mind
A tip step that points before this change and scrolls or moves after it (the fix only acts on a flat card).
