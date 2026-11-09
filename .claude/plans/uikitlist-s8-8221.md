# uikitlist-s8-8221: long press on the UIKit chat list, proven and kept (kosmos#8221, slice 8)

Stacked on uikitlist-s7-8221 (PR #8278). Rebase onto main once it merges.

## Finished looks like

The long-press checks (LongPressKeyboardUITests, 7; DeleteMessageUITests, 3) run on the UIKit list in CI's "uikit list
(sample board)" job, each chat launch asserting it really is drawn by the UIKit list, and pass. The Settings footer stops
saying that holding a message to copy or delete it is missing from the new list.

## Why now

Slice 7's footer still lists long press as missing. Slice 1 carried the long-press sheet's environment into each hosted cell,
and nothing had checked whether that is all long press needs. Measured first, before building anything.

## Measured (11-09, iPhone 17e iOS 26.5, Debug sample board)

- Both classes on the UIKit list (TEST_RUNNER_KOSMOS_UIKITLIST=1): 10 of 10 pass (02:5x CST). Control, the lazy list: 10 of 10.
- Then with UIKitListArm.assertDrawn on every chat launch (the list's "chat-list-uikit" identifier present; the one room check
  is exempt, a room is not drawn by ChatList): 10 of 10 on the UIKit list (03:0x CST). So the pass is the UIKit list's own.

## Decided

- No code change to the list: long press already works there. This slice adds the checks to the UIKit run, so a later change
  to the list cannot break long press silently, and corrects the footer.
- UIKitListArm.assertDrawn: a pass on the UIKit arm must be the UIKit list's. Rejected: asserting only once per class (a
  launch could open a different list). Weakest premise: that the identifier is present only on the UIKit list (it is set in
  ChatList.makeUIView, Debug or not, and nowhere else).
- The two classes run in the UIKit arm only, as they did not run in the lazy arm's CI list before either (they ran by hand).
  Rejected: adding them to the lazy arm too, which would lengthen that job for no new coverage of this card.

## Steps

1. UIKitListArm.set and assertDrawn in both classes' launch.
2. ui-sample.sh --uikit: LongPressKeyboardUITests:7 DeleteMessageUITests:3 added.
3. Settings footer: "A test of a new way to draw your chats. Some of the scrolling is not in it yet. Applies to the next chat
   you open." Shots, light and dark and largest text.
4. Settings and room suites, the node tests that read ios/ (git grep), ui-sample.sh --uikit, full validation, review
   (bounded at 2: a test-and-copy change), PR, merge on green.

## Status

- [x] Measured (above).
- [ ] Steps 1 to 4.
