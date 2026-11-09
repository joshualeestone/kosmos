# uikitlist-s11-8221: a scroll up without a finger is not held at the end (UIKit chat list)

Card: joshualeestone/kosmos#8221, slice 11. Open since slice 4's review: on the UIKit list, a scroll up from the newest
message made without a finger (VoiceOver's three-finger swipe, Voice Control, Full Keyboard Access, a keyboard's Page Up)
shows the list held at the end and then jumping to where the scroll ends.

## Scope

VoiceOver's three-finger page scroll, Voice Control and Full Keyboard Access (through accessibilityScroll) and a hardware
keyboard's scroll keys, and the status-bar tap (scrollViewShouldScrollToTop, the same kind of scroll; review iteration 7,
not covered by a check). NOT VoiceOver's one-finger swipe to the element above, which scrolls that element into view by
another path and never calls personScrolls: a reader at the newest who swipes back past the first screen is still pinned to
the end, as before this slice (review iteration 5). A later slice.

## Finished looks like

On the UIKit list, such a scroll moves the list from the first frame, the list never puts itself back at the end while it
runs, and where it ends decides whether the reader is at the newest (as slice 4 already made true). A scroll at an edge
that moves nothing and reports no end does not leave the list in a "scrolling" state.

## Cause (read from ChatList.swift, then measured)

The scroll is an animation, so the list is not tracking, dragging or decelerating while it runs. laidOut runs on every
frame and, with the reader at the newest (atEnd), pins the list back to its end. Measured with the fix off (control arm):
18 pins in one page scroll, and the scroll ended where it began (moved 0, still at the newest). So on the UIKit list a
VoiceOver or keyboard scroll up from the newest did not just jump; it did nothing.

## Change

- Coordinator: personAskedAt / personUntil / windowCount / fingerlessScrolling() / personScrollStarted() /
  personScrollOpened() / personScrollLapsed(_:) / toNewest().
  personScrolls (already wired to accessibilityScroll and the scroll keys) records the ask. The scroll's first move within
  personScrollAsk (0.5 s) of it, not made by the list itself (pinning, applying, laying), opens the window; each later move
  keeps it open for personScrollQuiet (0.3 s). While open, laidOut leaves the list alone and scrollViewDidScroll reads the
  moves as the person's (atEnd, the place dropped). It closes on the reported end (scrolled) or lapses after the moves stop;
  a lapse keeps where the last move put the reader and runs laidOut. A press that moves nothing opens nothing and counts as
  no drag (before this slice it counted as one until some later scroll ended); its ask is let go after 0.5 s.
- Debug only: KOSMOS_SAMPLE_A11YSCROLL=<s> (with _MODE animated, stepped, still or jump) makes one scroll of VoiceOver's kind
  through personScrolls (accessibilityScroll itself scrolls nothing on a simulator with VoiceOver off, measured) and reports
  pins, at end, moved, window. KOSMOS_SAMPLE_NOPERSONSCROLL=1 turns the fix off (the control arms).

## Tests

- A11yScrollUITests (UIKit arm, 7; skipped on the lazy arm): three controls with the fix off (animated and stepped must see
  pins; still must count a drag);
  with the fix: animated (0 pins, moved, off the newest), stepped with no end (window opened, 0 pins, moved > 300 pt, off the
  newest), still (no window, still at the newest, moved 0, the drag let go); jump (window opened, then back at the newest).

## Measured (iPhone 17e simulator, iOS 27, 2 rounds each, 11-09 16:2x)

| mode | fix off (control) | fix on |
|---|---|---|
| animated page up | 18 pins, moved 0, still at newest | 0 pins, moved 423, off the newest |
| stepped, no end | 14 and 24 pins, moved 0 and -16 | 0 pins, window opened, moved 371, off the newest |
| still (nothing moves) | | 0 pins, no window, moved 0, at the newest |

The stepped scroll asks for 450 pt and moved 371 with no pin; where the other 79 went is not traced.

## Rejected

- Keying on private UIScrollView state: there is no public "a programmatic scroll is animating" flag.
- Opening the window on the ask (first version): a key press that moves nothing (an arrow moving focus) turned off pinning
  and holding for a second, and a held key kept it off (review iteration 1).
- A fixed window with no extension: a scroll longer than it would have the list hold the reader's place on each move,
  freezing it.

## Interruptions (review iteration 3)

- A jump to the newest (a send, New messages) while the window is open stops the scroll in place and closes the window, as
  a running fling is stopped (toNewest, moved out of updateUIView so the check can call it), so the scroll's later moves
  cannot read the reader off the newest again. Checked by the "jump" mode (review iteration 5).
- Review iteration 5: a fling's or drag's end landing between the ask and the scroll's first move (the scroll stops the
  fling) keeps the ask, the window and the drag; before, it wiped the ask and the window never opened.
- Review iteration 4: another scroll's end (an earlier fling's deceleration, a drag) landing inside the window does not close
  it; each move marks the list moving, so a lapse during a stalled frame does not hold the place and stop the scroll.
- Review iteration 6: an ask counts as the person's drag only once its scroll moves (the window opens), so a press that
  moves nothing never marks anything; each window is numbered and a lapse check from a closed one does nothing.
- Review iteration 7: an ask is recorded even while a window is open and a lapse leaves it, so a second scroll asked for
  as the first ends still opens its own window; rows landing above while such a scroll runs stop it in place (its fixed
  target no longer means the same place) and the place is held; toNewest closes the window before stopping the scroll.

## Deferred from review

- A row landing while such a scroll runs, with the reader still at the newest, is not followed until the moves stop (at most
  0.3 s after the last) or the end is reported. By design: following it would pin the list under the person's scroll.
- An unrelated move (the slice 4 scroll nobody asked for, a keyboard inset change) inside the 0.5 s after an ask is taken
  for the person's; bounded by the ask and documented, not guarded further.
- The stepped control depends on each move causing a layout pass that pins; measured red (14 and 24 pins), so it sees it.

- Review iteration 7 (W2): the window's lapse is wall-clock. A main-thread stall longer than personScrollQuiet (0.3 s) in
  the middle of an animated scroll lets it lapse while the animation still runs; a reader still within endSlack of the end
  is then pinned for the rest of it (the old behaviour, for that tail). A longer quiet time would hold every window longer
  and delay following a row that lands at the newest. Left as is; to the card.

## Weakest premise

The check drives the scroll by hand (personScrolls, then the scroll), because accessibilityScroll scrolls nothing on a
simulator without VoiceOver. That UIKit's VoiceOver and keyboard scrolls go through accessibilityScroll / pressesBegan and
then move the offset within half a second is read from the code and UIKit's behaviour, not measured here; only a real phone
with VoiceOver on shows it. The keyboard half is less sure still: the list sees scroll keys only when it is in the responder
chain, and with the message box focused it usually is not. Nothing here exercises pressesBegan.
