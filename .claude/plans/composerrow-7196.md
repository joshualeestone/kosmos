# composerrow-7196: on a phone the project room's newest row is not under the sticky composer

Card: joshualeestone/kosmos#7196. Design: Mona Lisa approved option 1 with conditions (the keyboard shrinks the thread,
not the composer; a short room keeps its natural height; the safe area is cleared; shots of a busy room, a short room
and the keyboard up).

## Finished looks like
In the phone tab layout, at the room's floor, the newest row (an ordinary post or a notice) sits above the composer:
at page top, with the keyboard up, and while a long message is being typed. Desktop and the consolidated layout are
unchanged.

## Measured cause
The room column ran about 85px past the screen in the phone tab layout (393x852), so the sticky composer covered the
thread's floor until the page was nudged down.

## Change
- web/index.html: pjFitRoomPhone() writes --pj-room-fit, the height between the thread's top (page at its top) and the
  composer, from the visible viewport (the keyboard shrinks it), floor 96px. It runs at the end of paintRoom, on
  window and visualViewport resize, and when the composer's own size changes (ResizeObserver; review 1). The phone CSS
  caps min-height and max-height with it, minus the bottom safe area. A reader at the newest row stays there; a short
  room keeps its natural height.
- docs/browser-checks/render-room-scroll.js: phone arms for the newest post, a notice, the keyboard up and a long typed
  message, with lifted-fit controls (at full size and with the keyboard up) that must see the row hidden.

## Rejected
- Moving the composer out of the flow: a bigger layout change, and the design asked for the thread to give way.
- A 160px floor (round 1): with the keyboard up only about 135px is left, and the newest row sat 25px under the
  composer (measured by the keyboard arm).

## Stated limit (review 2)
On a short phone (iPhone SE, 375x667) with the keyboard up, the page header above the room takes almost all of the
331px left, so with the page at its top no thread height clears the composer; the 96px floor leaves the newest row
under it there. Main is worse (no fit at all). Closing it needs the header to give way while typing, a separate change;
the design-shot keyboard screen checks phones from 700px tall up and says why below that.

## Weakest premise
That the page sits at its top while typing. If iOS scrolls the page when the composer takes focus, the thread's top
moves up and the fit is slightly smaller than needed, never larger, so the newest row stays clear.

## Checks
- render-room-scroll.js on the branch, all arms; the five checks the surface gate names (msgbox-2806,
  shell-noscroll-4872, unread-edge-3743, msgref-4631, room-reply-3745) green on the branch; both browser-check gates.

## Review 4 (blind, 10-26 evening)
- Fixed: the fit now takes off whatever is shown between the thread and the composer (the "agent is working" line,
  the Replying to bar), and re-fits when they, or the sealed line above the thread, show or hide (one ResizeObserver).
  Arm: Replying to opened through pjReplyPaint, with a control at the pre-review-4 fit.
- Fixed: a keyboard arm that moves only the visual viewport, as iOS does (the window-resize arm cannot tell whether the
  visualViewport listener exists), with a control that removes that listener.
- Fixed: the typing arm's control compares the composer's growth with the measured space under the newest row, not a
  fixed 20px that equalled the slack.
- Stated limits, not in this change: a project header that wraps after the room paints re-fits at the next room poll
  (up to about 5 s), and a phone in landscape (wider than 30rem) gets no fit at all, as on main (Renet's #7272 owns the
  header; landscape is a separate card if it matters).
