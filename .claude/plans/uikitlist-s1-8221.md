# kosmos#8221 slice 1: the UIKit chat list behind a switch

## Finished looks like
A Debug build with KOSMOS_SAMPLE_UIKITLIST=1 draws the iPhone chat with the UIKit list (ChatList: a UICollectionView whose
self-sizing cells host today's SwiftUI rows). It opens at the newest message, stays at the newest while the reader is there
(new rows, a row growing, the box growing or shrinking, the keyboard), draws the sends on their way and the working line as
its last cells, and leaves room at the end so the newest message's time is not clipped. A release build is unchanged: the
switch reads false, and the lazy list draws the chat exactly as before. The chat UI checks that cover slice 1 pass on both
lists, run by one switch (TEST_RUNNER_KOSMOS_UIKITLIST=1).

## Decided (from #8221, 22:51 CST 11-07)
- Switch the chat to a UIKit list, in slices, behind a switch, both lists shipped side by side. The spike (branch
  uikitlist-8221, never merged) measured 0 of 2,490 no-text samples on the UIKit list against 181 on the lazy list.
- Slice 1 only: open at the newest, keep at the newest, pending bubbles, working line, end room. Not in it: a reader's place
  as rows land above (slice 3), earlier pages (4), the capsule beyond setting unseenNew (5), search anchoring (7), the side
  lock (8), long press beyond carrying the sheet's environment (9), accessibility (10).

## Shape
- ios/Kosmos/ChatList.swift: UIViewRepresentable. Diffable data source keyed by the chat's own ids; cells built by a closure
  from ChatView (row(), pendingBubble(), empty, noMatch, the working line, the end room). Kept at the end by pinning the
  offset to the end after any layout that changed the list's or the content's height while the reader is at the end, never
  under a finger or fling. "At the end" is decided only by the person's own scroll (40 pt slack); a send or New messages
  bumps `newest`, which goes to the end from anywhere.
- ChatView: `static let uikitList` (Debug env only; release false). `conversation` picks conversationUIKit or
  conversationLazy. pendingBubbles split into pendingBubble so one send is one cell.
- UI tests: UIKitListArm.set(app) before each launch in the slice-1 classes; TEST_RUNNER_KOSMOS_UIKITLIST=1 picks the list.

## Rejected
- reloadData on every change (the spike): it re-estimates every cell; the diffable apply keeps measured heights.
- scrollToItem for the end: it lands on estimated heights; pinning the offset after layout converges as cells measure.
- A release-readable defaults key now: nothing in the app sets it yet; the TestFlight slice adds the switch a phone can flip.

## Weakest premise
That a hosted cell's SwiftUI content draws whenever its cell is on screen. Batch 2 measured that on the simulator (ink in
every sample), not on Josh's phone; the phone counts compare the two lists in the TestFlight slice before the old one goes.

## Steps
1. [x] ChatList.swift, the switch, conversationUIKit, pendingBubble split.
2. [x] UIKitListArm in the six classes.
3. [ ] UIKit arm: ChatOpensAtNewest (2), KeyboardSlide at-the-newest checks (4), SendMovesOnce (3), ComposerSend (3),
       StopAdding (2). Lazy arm: same set, unchanged behaviour.
4. [ ] iOS repo tests that read Swift (node ios tests, LogicTests run-*.sh).
5. [ ] Challenge loop, PR, merge on green.
