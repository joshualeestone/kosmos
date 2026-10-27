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
html.kosmos-keyboard-up, hide #askcard (a body child), #pj-one-view > .pj-crumbrow (Back and the crumb) and
#pj-one-view .pjmidhead (title row and search; with it the Read aloud button and the paused, goal and pause-result
lines). They return when either condition ends. Kept, as in the talk view: Kosmos's top bar and the connection notice
(#conn). Kept also while the room search holds a query.

## Rejected
- Only when the visible height cannot fit header + newest post (the card's literal wording): a height test in JS for
  one more state, and on an iPhone 15 the header still costs most of the thread while typing. Hiding it whenever the
  keyboard is up while typing matches the talk view the person already knows. Reversible in a line.
- Hiding the top bar too: global navigation; the talk view keeps it, and the SE has room once the rest steps aside.
- A focusin/focusout re-fit of the thread (first draft), removed because a mutation left every arm green. THAT WAS
  WRONG: the arms measured a gap a stale fit leaves unchanged (see round 2). A re-fit IS needed. It is now a
  ResizeObserver on the elements that hide, which also catches #conn changing height; a focus listener would not.

## Proof
- docs/browser-checks/render-room-scroll.js section 4c, 50 of 50 with #7196's arms:
  - SE (Chromium): typing with the keyboard up hides the header, the newest row sits just above the composer (within
    40px) and no header control is under it. The read makes no fit call of its own.
  - CONTROL: with the header forced back, the same read sees the collision (the card's screen).
  - The connection notice stays on screen while typing.
  - A room search holding a value keeps the header.
  - On 393x852, from the search box to the composer with the keyboard already up (no resize), the thread takes the
    freed space: the composer ends at the visible bottom.
  - Focus leaving brings the header back, and with the keyboard closed the newest row clears the composer.
- Mutations, each red on its own arm, file restored and cmp-checked:
  - the .pjmidhead hide removed;
  - the search clause removed;
  - #conn hidden again;
  - the header ResizeObserver removed (the composer floats 150px above the keyboard).
- Shots: room-typing-7272 (focus first, then the keyboard), every phone size, Chromium and WebKit. Its verify fails if
  the header still shows at 30rem or narrower.
- Guards that name the touched code: 19 files, 213 of 213.

## Weakest premise
That keyboard-up plus composer focus is the right trigger on real iOS. It is the trigger the talk view has used since
#718 with the same listener, but the check fakes the keyboard by shrinking the viewport; a real iPhone run is the
measurement this lacks.

## What would change my mind
A real iPhone showing the header flash back mid-tap (the talk view's rule excludes add-a-file for that reason), or a
person who needs the room's search while composing.

## Review rounds
1. (default model, 20:0x CDT) No BLOCKER. Applied:
   W: #conn was hidden too, which the talk view never does, and the comment said it matched the talk view. #conn is the
   one line saying the subscription is unreachable, and as a live region it is not announced while hidden. It is now
   kept. Arm: the notice stays on screen while typing (red with #conn hidden again).
   W: the 393x852 arm and the 4c comments described a focus re-fit that had been removed, and the arm passed without
   this change. Deleted; the comments were corrected.
   W: a room search holding a query was hidden while typing, so a filtered room looked unfiltered. The header now stays
   while the search has a query. Arm: red with that clause removed.
   NITs: the first arm no longer calls pjFitRoomPhone itself (only the forced control does), so it reads what the page
   did. With #conn kept it still fits: 255 against the composer's 259. "#d-talk-box above" is now "below". "short phone"
   is now "phone". The comment lists what goes with the title row.
   Check 49 of 49. Mutations: the .pjmidhead hide (red), the search clause (red), #conn hidden again (red).
2. (sonnet, 20:1x CDT) No BLOCKER. Applied:
   W: moving focus from the search box to the composer with the keyboard already up fires no resize, so the thread kept
   the cap it had under the header. Measured on 393x852 with no fix: fit 115px, and the composer floated 150px above the
   keyboard (its bottom at 366 of 516 visible), because the composer follows the thread. Now a ResizeObserver on
   .pjmidhead, .pj-crumbrow, #askcard and #conn re-fits whenever their height changes. That covers #conn appearing or
   wrapping later too (the reviewer's NIT 2). Arm on 393x852: the composer ends at the visible bottom and the newest row
   sits just above it. Red with the observer removed (the 150px band). On the SE the fit under the header is already at
   its 96px floor, so a stale fit cannot show there.
   ⚠️ Self-correction: my first two versions of this arm passed with the observer removed, because they measured the
   gap between the thread and the composer, which a stale fit leaves unchanged. Only a probe of the fit and the
   composer's position showed where the band went (under the composer). My round-0 rejection of a focus re-fit
   ("a mutation left every arm green") had the same blind spot.
   NIT: the first arm also asserts the newest row is within 40px of the composer (it fills the space, not only clears
   it). NIT: the comment says "a non-empty value" (spaces keep the header; safe).
   Check 50 of 50. Mutations: observer off (red), plus the three from round 1.
3. (default model, 20:3x CDT) No BLOCKER or WARNING. NITs applied: (1) the Proof section described a deleted arm and
   an old count; rewritten. (2) The shot could pass on the old layout; its verify now fails if the header shows where
   the rule applies (wider sizes show the room unchanged). (3) With the phone-pairing card stepped aside, #conn lost the
   floating notices' clearance; a rule gives it back while typing. The talk view (#d-talk-box) has the same latent gap,
   outside this card.
4. (sonnet, 20:4x CDT) No new findings. Converged. One optional NIT declined: the shot's header read returns 0 if
   .pjmidhead were absent, but newestAbove7196 runs first and fails on a missing room or fewer than 24 posts.
   Next: validation and PR after #7196 merges and this branch is rebased onto main (the diff hash is taken against main).
