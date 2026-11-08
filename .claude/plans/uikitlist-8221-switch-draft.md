# Draft (posted only if batch 2 confirms): switching the iPhone chat to the UIKit list

## Shape
One UICollectionView (self-sizing cells hosting today's SwiftUI rows via UIHostingConfiguration), owned by a coordinator
that holds the scroll state ChatView keeps in @State today. The SwiftUI rows, bubbles, day lines, way-through rows, the
composer and the info page are unchanged. Behind a release switch, both lists shipped side by side for a TestFlight
cycle, so the phone counts (GET /api/phone/chat-opens) compare them on the same phone.

## What has to be rebuilt on the new list (each with the UI test that already holds it)
1. Opening at the newest message (ChatOpensAtNewestUITests).
2. Kept at the newest while there, when new messages land, the box grows or the keyboard rises (KeyboardSlideUITests,
   SendMovesOnceUITests). The spike already does the height case.
3. A reader higher up stays put: new messages below, a page loading above, the keyboard rising (keyAnchor, KeyboardHold;
   KeyboardSlideUITests testReadHigherUpStaysWhereItWas, LongPressKeyboardUITests). UIKit: adjust contentOffset by the
   height inserted above, in the same layout pass.
4. Earlier pages load at the top, with their line and Try again (loadEarlier, earlierFailedLine; EndPullUITests).
5. The New messages capsule and atBottom / unseenNew (from contentOffset, not an end marker's appear).
6. Pending bubbles and the working line as the last cells (ComposerSendUITests, DotsRefreshUITests, StopAddingUITests).
7. Search filtering (a data change; the list is not anchored while searching).
8. Interactive keyboard dismissal (keyboardDismissMode), and the side lock (SideScrollLock: alwaysBounceHorizontal off,
   contentSize width pinned; likely no longer needed, measured before removing).
9. Long press, delete, attachments, previews: per row, unchanged (DeleteMessageUITests, AttachedPreviewUITests,
   AttachMenuUITests).
10. Accessibility: VoiceOver order and the #8200 loop at the largest text, checked on the new list.

## What goes away if the new list holds
The blank machinery written for the lazy list: recoverEmpty and the rebuild budget, diagCheck and the diagnostic report,
settledPutBack's within-content arms, the rebuild hide, the BlankListRing. Kept until the new list has a TestFlight
cycle with 0 blanks in the phone counts.

## Rooms
RoomView uses the same kind of list and the same rebuild idea; a second card once the chat holds.

## Cost and order
Largest pieces: 3 (place keeping) and 4 (earlier pages). Order: 1, 2, 6, 5, 7, 8 behind the switch with their tests
on both lists; then 3 and 4; then 9, 10; then TestFlight with the switch; then remove the old list.
