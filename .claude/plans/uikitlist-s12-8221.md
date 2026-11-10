# uikitlist-s12-8221: VoiceOver's swipe to a message above the screen is not pinned to the end (UIKit chat list)

Card: joshualeestone/kosmos#8221, slice 12. Stacked on slice 11 (branch uikitlist-s11-8221, PR #8343); rebase onto main
once that merges.

## Scope

On the new chat list, a VoiceOver reader at the newest message swipes left (one finger) to the element above, past the
first screen. VoiceOver moves its focus to a message above the screen and scrolls it into view by its own path, which never
calls accessibilityScroll (so slice 11's personScrolls does not see it). The list, still counting the reader at the newest,
puts itself back at the end on the next layout: the focused message is off screen again, or the scroll never happens.

Not in scope: the old (lazy) list; slice 11's leftovers (on #8221); a focus move that stays within the screen (nothing
changes for it).

## Finished looks like

When VoiceOver (or Switch Control: same notification) focuses something in a row before the newest message (the working
line and the spacer after it are not messages) and that thing is not fully in the safe area, it is put on screen, the
reader is at the newest or not by where the list then lands, and the list does not put it back off screen on the next
layout. A focus on something already on screen, or on the newest message however tall, changes nothing.

## Change

- Coordinator.focusFollow(_ element:), from UIAccessibility.elementFocusedNotification (observer added in makeUIView,
  replaced if made again, removed when the coordinator goes).
  - Which row: walk the element's accessibilityContainer chain to its first UIView, then its superviews to a cell of this
    list. If the walk reaches the list with no cell (UICollectionView's own element for a row with no cell), the row at
    the element's frame. A view chain that leaves the list (the composer), one through a view of the list that is not a cell,
    or the list itself as the element, is ignored.
  - A finger on the list (tracking, dragging, a fling), or slice 11's scroll without a finger still running: nothing.
  - Rows from the newest message on (the last id that is not "working" or "end"): not moved, however tall the message.
    If the reader was off the newest (heldByFocus or not atEnd), heldByFocus is cleared and the reader is at the newest
    once that message is wholly shown (newestShown: measured 11-09, with it fully in view the list was 53 pt short of its
    end, more than the 40 pt slack) or the list is within the usual slack of its end, read now and again 0.6 s later,
    retried while the list is still moving, up to four times (VoiceOver's scroll to it may have no animation, so no
    scroll end). A later focus back or a scroll of the person's starts a new count; the older reads do nothing.
  - The same element focused again (same row, same place within the row), with an update (apply) between: nothing. That is VoiceOver putting its
    focus back after the cells were redrawn (a streaming reply), not the person moving. Another part of the same message
    is followed. Cost: a person who swipes back to the very element they last focused, after an update, is not followed.
  - Within 1 s of toNewest() (a send, New messages, search closing) or of the list being made (a chat opening): nothing, since VoiceOver puts its focus on something
    on screen after such a jump and that is not the person moving.
  - Decided and moved by the focused element's own frame (a part of a tall message), the row's when it has none; with
    the row's frame, measured again after the layout the move causes (rows drawn for the first time change height) and
    put right once. Off
    screen is measured against the safe area, not the list's own padding; the move keeps the padding.
  - After the move: heldByFocus is set, so until the person scrolls or the reader is at the newest again only the very
    end counts as the newest (endReached, used by hold(), scrolled() and focusFollow). Without it, a message cut off by up
    to the list's 40 pt slack was pinned back under the bar at the next layout. Then atEnd = endReached, and when not at
    the end the place is held by the focused row itself (measured 11-09: held by the highest row on screen, rows drawn
    for the first time below it came in 16 pt taller than estimated and pushed a message put at the bottom back off). A
    scroll that ends while heldByFocus (VoiceOver's own, to that row), or a layout after one with no end reported, keeps
    the place on the focused row (focusPlace). Trade-off: while heldByFocus only the very end counts as the newest, so a
    VoiceOver scroll that stops a few points short leaves the reader counted higher up until they scroll or reach it.
- Order: whichever comes first. Focus first: atEnd is false before VoiceOver's scroll, which is then followed as any
  scroll with no finger is for a reader higher up. Scroll first: laidOut pinned it back, then the focus brings it on.
- Debug only: KOSMOS_SAMPLE_A11YFOCUS=<s> with _MODE visible, above, after, first, newest, below, clipped, back,
  refocus or afterjump;
  KOSMOS_SAMPLE_NOFOCUSFOLLOW=1 is the control arm (the observer does nothing). A layout pass is forced 2 s after the
  hook starts (after every mode's focus), and pins are counted for 3 s after each focus. Report: found, at end, on screen, agrees (atEnd matches endReached), pins, moved, element kind, from the end.
- A11yFocusUITests (12) in the UIKit CI arm (ios/tools/ui-sample.sh).

## Weakest premise

The order and kind of VoiceOver's own scroll-to-visible, and whether its focused element for a row is the SwiftUI element in
the cell or UICollectionView's own, cannot be seen on a simulator (VoiceOver does not run there). The checks post the same
notification VoiceOver posts, with a real SwiftUI element for an on-screen row and a list-contained element for a row with
no cell. If VoiceOver scrolls first and its element is a SwiftUI one in a cell that was then reused for another row (the
list pinned back), the follow can name the wrong row or none; not seen on a simulator. A real phone with VoiceOver on is
the check that remains. Also unseen there: a focus VoiceOver moves by itself (refocusing a reconfigured cell after an
update, or after an announcement), which the follow takes as the person's when it lands off screen; the jump to the newest and
a refocus of the same row after an update are excluded, other self-moves are not.

## Steps

1. focusFollow + observer + debug hook.
2. A11yFocusUITests (12), run on iOS 26.5 (CI's runtime) and 27; control arm must read pinned.
3. ui-sample.sh UIKit class list; focused validation; challenge loop (8-round cap).
4. PR stacked on #8343; merge after it.
