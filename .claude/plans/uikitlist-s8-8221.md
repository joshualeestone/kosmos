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

- Both classes on the UIKit list (xcodebuild -only-testing the two classes, TEST_RUNNER_KOSMOS_UI_PLUS=1 and
  TEST_RUNNER_KOSMOS_UIKITLIST=1): 10 of 10 pass (02:5x CST). Control, the lazy list, same run: 10 of 10.
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
- [x] Steps 1 to 3 (777442664f, rebased onto main after #8278 merged). Footer shots ~/work/design-shots/kosmos-8221-s8/.
- [x] ui-sample.sh --uikit on the final code: PASS 26 of 26 (04:0x-04:19 CST, iPhone 17e iOS 27.0), no retries.
- [x] Review round 1 (sonnet): no BLOCKER or WARNING; converged. NITs: VoiceOver's copy and delete actions on UIKit-list
      cells are not measured (the footer speaks of holding a message, not of VoiceOver; NOT MEASURED, a later slice's
      accessibility work, slice 1's list item 10); this Status was stale (fixed here); assertDrawn could use the narrower
      collectionViews query (skipped: speed only).
- [x] Full validation PASSED (04:41 CST, hash 839742af9c00, 27723 tests); main had not moved.
- [ ] PR, CI (UIKit job 26 checks), merge on green.
