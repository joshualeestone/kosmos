# #7272: on a short phone with the keyboard up, the room header gives way while typing

Stacked on composerrow-7196 (Angel's #7196, unmerged): that branch sizes the room thread from its top
(pjFitRoomPhone), so the header's height is part of its arithmetic. This branch rebases onto main when #7196 lands.

## Seen (before)
iPhone SE (375x667), 336px keyboard, project room: Kosmos's top bar, the connection notice (#conn), Back, the title row
and the search field took all ~331px; no post above the composer, which half-covered the search field. Reproduced in the
shot tool (room-keyboard-7196, both engines).

## The call
CSS in the phone room block (max-width: 30rem, not consolidated), mirroring the agent talk view's rule (#d-talk-box):
while focus is in the room composer's text box, Post, the mic or the emoji button (not add-a-file, as there), AND
html.kosmos-keyboard-up, hide #askcard and #conn (body children), #pj-one-view > .pj-crumbrow (Back and the crumb) and
#pj-one-view .pjmidhead (title row and search). They return when either condition ends. Kosmos's top bar stays, as in
the talk view.

## Rejected
- Only when the visible height cannot fit header + newest post (the card's literal wording): a height test in JS for
  one more state, and on an iPhone 15 the header still costs most of the thread while typing. Hiding it whenever the
  keyboard is up while typing matches the talk view the person already knows. Reversible in a line.
- Hiding the top bar too: global navigation; the talk view keeps it, and the SE has room once the rest steps aside.
- A focusin/focusout re-fit of the thread (first draft): a mutation removing it left every arm green, including one
  built to need it (393x852, focus leaving with the keyboard up), so it was not needed and was removed.

## Proof
- docs/browser-checks/render-room-scroll.js section 4c (SE, Chromium): typing with the keyboard up hides the header,
  the newest row is above the composer and no header control is under it; CONTROL: the header forced back, the same
  read sees the collision (the card's screen); focus leaving brings the header back and with the keyboard closed the
  newest row clears the composer; on a 393x852 phone focus leaving with the keyboard up keeps the newest row above the
  composer. 44 of 44.
- Mutation: the .pjmidhead hide removed, the first 4c arm reds with the card's numbers (search under the composer,
  newest row 405 vs composer 259). Restored, cmp-checked.
- Shots: room-typing-7272 (focus first, then the keyboard), SE and iPhone 15, Chromium and WebKit, 0 overflow.
- Guards that name the touched code: 19 files, 213 of 213.

## Weakest premise
That keyboard-up plus composer focus is the right trigger on real iOS. It is the trigger the talk view has used since
#718 with the same listener, but the check fakes the keyboard by shrinking the viewport; a real iPhone run is the
measurement this lacks.

## What would change my mind
A real iPhone showing the header flash back mid-tap (the talk view's rule excludes add-a-file for that reason), or a
person who needs the room's search while composing.

## Review rounds
