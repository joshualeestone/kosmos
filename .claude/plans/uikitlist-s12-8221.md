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

When VoiceOver (or Switch Control: same notification) focuses a message of this list that is not fully on screen and is not
the newest row, the reader is no longer counted at the newest, that message is on screen, and the list does not put itself
back at the end afterwards. A focus on a message already fully on screen changes nothing.

## Change

- Coordinator.focusFollow(_ element:), from UIAccessibility.elementFocusedNotification (observer added in makeUIView,
  removed when the coordinator goes).
  - Which row: walk the element's accessibilityContainer chain to its first UIView, then its superviews to a cell of this
    list. If the walk reaches the list itself with no cell (UICollectionView's own element for a row with no cell), map the
    element's accessibilityFrame (screen space) to an index path. A view chain that leaves the list (the composer) is not
    ours: nothing happens.
  - The newest row, a row fully on screen, or a finger on the list: nothing happens.
  - Otherwise: atEnd = false, the row is put on screen with the list's own write (pinning), and the place is taken from
    where it now is, so later layouts hold it there.
- Order: whichever comes first. Focus first: atEnd is false before VoiceOver's scroll, so that scroll is followed as any
  scroll with no finger is for a reader higher up. Scroll first: laidOut pinned it back, then the focus brings the row on
  screen and stops the pin.
- Debug only: KOSMOS_SAMPLE_A11YFOCUS=<s> with _MODE visible, above, after or first; KOSMOS_SAMPLE_NOFOCUSFOLLOW=1 is the
  control arm (the observer does nothing). Report: found, at end, on screen, pins, moved, element kind.
- A11yFocusUITests in the UIKit CI arm (ios/tools/ui-sample.sh).

## Weakest premise

The order and kind of VoiceOver's own scroll-to-visible, and whether its focused element for a row is the SwiftUI element in
the cell or UICollectionView's own, cannot be seen on a simulator (VoiceOver does not run there). The checks post the same
notification VoiceOver posts, with a real SwiftUI element for an on-screen row and a list-contained element for a row with
no cell. A real phone with VoiceOver on is the check that remains.

## Steps

1. focusFollow + observer + debug hook.
2. A11yFocusUITests, run on iOS 26.5 (CI's runtime) and 27; control arm must read pinned.
3. ui-sample.sh UIKit class list; focused validation; challenge loop (8-round cap).
4. PR stacked on #8343; merge after it.
