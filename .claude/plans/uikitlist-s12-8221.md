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
    the element's frame. A view chain that leaves the list (the composer), or the list itself as the element, is ignored.
  - Rows from the newest message on (the last id that is not "working" or "end"), or a finger on the list: nothing.
  - Decided and moved by the focused element's own frame (a part of a tall message), the row's when it has none. Off
    screen is measured against the safe area, not the list's own padding; the move keeps the padding.
  - After the move: heldByFocus is set, so until the person scrolls or the reader is at the newest again only the very
    end counts as the newest (endReached, used by hold(), scrolled() and focusFollow). Without it, a message cut off by up
    to the list's 40 pt slack was pinned back under the bar at the next layout. Then atEnd = endReached, and a place is
    taken when not at the end.
- Order: whichever comes first. Focus first: atEnd is false before VoiceOver's scroll, which is then followed as any
  scroll with no finger is for a reader higher up. Scroll first: laidOut pinned it back, then the focus brings it on.
- Debug only: KOSMOS_SAMPLE_A11YFOCUS=<s> with _MODE visible, above, after, first, newest, below or clipped;
  KOSMOS_SAMPLE_NOFOCUSFOLLOW=1 is the control arm (the observer does nothing). A layout pass is forced 1 s after the
  focus. Report: found, at end, on screen, agrees (atEnd matches endReached), pins, moved, element kind, from the end.
- A11yFocusUITests (9) in the UIKit CI arm (ios/tools/ui-sample.sh).

## Weakest premise

The order and kind of VoiceOver's own scroll-to-visible, and whether its focused element for a row is the SwiftUI element in
the cell or UICollectionView's own, cannot be seen on a simulator (VoiceOver does not run there). The checks post the same
notification VoiceOver posts, with a real SwiftUI element for an on-screen row and a list-contained element for a row with
no cell. If VoiceOver scrolls first and its element is a SwiftUI one in a cell that was then reused for another row (the
list pinned back), the follow can name the wrong row or none; not seen on a simulator. A real phone with VoiceOver on is
the check that remains.

## Steps

1. focusFollow + observer + debug hook.
2. A11yFocusUITests (9), run on iOS 26.5 (CI's runtime) and 27; control arm must read pinned.
3. ui-sample.sh UIKit class list; focused validation; challenge loop (8-round cap).
4. PR stacked on #8343; merge after it.
