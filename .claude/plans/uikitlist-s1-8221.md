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
  lock (8), long press beyond carrying the sheet's environment (9), accessibility (10). Also not in it: the pull past the
  end for a read (#8072, endPull attaches through the lazy list's scroll view), the earlier-loading and failed lines, and
  the keyboard's settled looks (settleAtNewest), which the lazy list needs and the new list may not.

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

- Reconfiguring only the cells whose content changed (a per-id signature). A row's drawing depends on ChatView state well
  beyond its data (hidden heads, file states, thumbnails, armed presses), so a data signature would leave stale cells. The
  cells on screen are drawn again on every update instead; the cost on a keystroke is measured before the TestFlight slice.

## Weakest premise
That a hosted cell's SwiftUI content draws whenever its cell is on screen. Batch 2 measured that on the simulator (ink in
every sample), not on Josh's phone; the phone counts compare the two lists in the TestFlight slice before the old one goes.

## Steps
1. [x] ChatList.swift, the switch, conversationUIKit, pendingBubble split.
2. [x] UIKitListArm in the six classes.
3. [x] UIKit arm, iPhone 17 Pro Max, iOS 26.5, 11-07/08: ChatOpensAtNewest 2/2, KeyboardSlide at-the-newest 4/4,
       SendMovesOnce 3/3 (after the cell-spacing fix), ComposerSend 3/3, StopAdding 2/2. The UIKit arm is run by hand with
       TEST_RUNNER_KOSMOS_UIKITLIST=1; CI runs the lazy arm only, which is what a release build ships.
       Lazy arm, same set: KeyboardSlide testNewestStaysJustAboveTheBoxAsItGrowsAndShrinks fails intermittently with a
       455 pt jump on untouched main too (main 1 of 3, this branch 1 of 4), the #7817 jump; ChatOpensAtNewest times out its
       queries on the 260-message chat (documented in ui-sample.sh). Everything else passes.
4. [x] iOS repo tests that read Swift: 15 node files (one trace value fixed), all 13 LogicTests suites PASS.
5. [ ] Challenge loop, PR, merge on green.
