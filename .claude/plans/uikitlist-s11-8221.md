# uikitlist-s11-8221: a scroll up without a finger is not held at the end (UIKit chat list)

Card: joshualeestone/kosmos#8221, slice 11. Open since slice 4's review: on the UIKit list, a scroll up from the newest
message made without a finger (VoiceOver's three-finger swipe, Voice Control, Full Keyboard Access, a keyboard's Page Up)
shows the list held at the end and then jumping to where the scroll ends.

## Finished looks like

On the UIKit list, such a scroll moves the list from the first frame, the list never puts itself back at the end while it
runs, and where it ends decides whether the reader is at the newest (as slice 4 already made true). A scroll at an edge
that moves nothing and reports no end does not leave the list in a "scrolling" state.

## Cause (read from ChatList.swift)

The scroll is an animation, so the list is not tracking, dragging or decelerating while it runs. laidOut runs on every
frame and, with the reader at the newest (atEnd), pins the list back to its end. When the animation ends, scrolled()
reads where it went and lets the reader go: the jump.

## Change

- Coordinator: personUntil / personScrolling() / personScrollStarted() / personScrollLapsed(). personScrolls (already wired
  to accessibilityScroll and the scroll keys) opens a window of personScrollWindow (1.0 s). While it is open, laidOut leaves
  the list alone and scrollViewDidScroll counts the moves as the person's (atEnd read from them, the place dropped). The
  window closes on the scroll's reported end (scrolled) or lapses on its own; a lapse keeps the reader's last-read state
  (at the newest stays at the newest, even if a message landed) and runs laidOut.
- Debug only: KOSMOS_SAMPLE_A11YSCROLL=<s> makes one scroll up of VoiceOver's kind (personScrolls, then an animated page
  scroll; accessibilityScroll itself scrolls nothing on a simulator with VoiceOver off, measured) that long after the list opens and reports
  how often pin() moved the list in the next 1.5 s; KOSMOS_SAMPLE_NOPERSONSCROLL=1 turns the fix off (the control arm).

## Tests

- A11yScrollUITests (UIKit arm; skipped on the lazy arm): the control (fix off) must see pins > 0; with the fix, 0 pins, the
  list moved up more than 40 pt, and the reader no longer at the newest.

## Rejected

- Keying on isAnimating-style private state: there is no public "a programmatic scroll is animating" flag on UIScrollView.
- No deadline (window open until scrolled()): an accessibility scroll at an edge reports no end, so it could stay open and
  stop laidOut from ever pinning again.

## Weakest premise

The window is kept open by the scroll's own moves (personScrollQuiet, 0.3 s after the last one) and closed by its reported
end. A scroll whose first move comes more than 1.0 s after it was asked for would find the window already closed and be
pinned as before this slice. Not seen; UIKit starts an animated scroll on the next frame.

A first version closed the window after a fixed 1.0 s. Thinking through an animation longer than that: the reader is
already off the end by then, so laidOut would HOLD their place on each frame and freeze the scroll, worse than the old
jump. Hence the window extended by moves.
