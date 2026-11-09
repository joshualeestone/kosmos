# uikitlist-s10-8221: search and the keyboard drag checked in CI on the UIKit chat list (kosmos#8221, slice 10)

Stacked on uikitlist-s9-8221 (PR #8281). Rebase onto main once it merges.

## Finished looks like

ChatSearchUITests (1) and ChatDragUITests (1) run in CI's UIKit list job (ui-sample.sh --uikit), and each launch
asserts the UIKit list drew the chat, so a pass on that arm cannot come from the lazy list. Items 7 (search) and 8
(interactive keyboard dismissal) of the card's list are then held by CI on the new list, not only by a run by hand.

## Measured (11-09, iPhone 17e iOS 26.5)

- 07:08 to 07:11, before the change: both classes 3 of 3 on the UIKit arm. But neither asserted which list drew the
  chat (UIKitListArm.set only), so that pass could not tell the lists apart.
- 07:12 to 07:14, with UIKitListArm.assertDrawn after each launch: both 3 of 3 on the UIKit arm.
- assertDrawn is the shared helper slice 8 proved can fail (it waits for the "chat-list-uikit" identifier, set only in
  ChatList.makeUIView).
- ios.ui-sample-tally-7609.test.js: 2 of 2.

## Not in this slice

- The lazy arm's CI list is unchanged; these two classes stay out of it, as before.
- VoiceOver copy and delete on UIKit cells (item 10) are still not measured.

## Status

- [x] assertDrawn in both classes; both added to the UIKit classes in ui-sample.sh.
- [x] Measured 3 of 3 each, with the assertion.
- [ ] Review (bounded at 1 round: a test-only change), proof, PR after #8281 merges and this is rebased.
