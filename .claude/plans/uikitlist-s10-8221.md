# uikitlist-s10-8221: search and the keyboard drag checked in CI on the UIKit chat list (kosmos#8221, slice 10)

Stacked on uikitlist-s9-8221 (PR #8281). Rebase onto main once it merges.

## Finished looks like

ChatSearchUITests (1) and ChatDragUITests (1) run in CI's UIKit list job (ui-sample.sh --uikit), and each launch
asserts the UIKit list drew the chat, so a pass on that arm cannot come from the lazy list. Items 7 (search) and 8
(interactive keyboard dismissal) of the card's list are then held by CI on the new list, once CI's uikit job is green on
the PR (every run below is local).

## Measured (11-09, iPhone 17e iOS 26.5)

- 07:08 to 07:11, before the change: both classes 3 of 3 on the UIKit arm. But neither asserted which list drew the
  chat (UIKitListArm.set only), so that pass could not tell the lists apart.
- 07:12 to 07:14, with UIKitListArm.assertDrawn after each launch: both 3 of 3 on the UIKit arm.
- assertDrawn is the shared helper slice 8 proved can fail (it waits for the "chat-list-uikit" identifier, set only in
  ChatList.makeUIView). Carried over from slice 8, not measured red on this branch for these two classes.
- ios.ui-sample-tally-7609.test.js: 2 of 2 (it does not read the classes list, so it says nothing about this change).

## Review round 1 (blind, bounded at 1): no BLOCKER

- SHOULD: the script header still said ChatSearch and ChatDrag stay by hand. FIXED (and points at classes= for the list).
- NIT: say why the two are not in the lazy arm's list. FIXED.
- NIT: the plan claimed CI holds them before any CI run; and the tally test proves nothing here. FIXED (wording).
- NIT: assertDrawn's failing arm is carried over from slice 8. RECORDED above.

## Not in this slice

- The lazy arm's CI list is unchanged; these two classes stay out of it, as before.
- VoiceOver copy and delete on UIKit cells (item 10) are still not measured.

## Status

- [x] assertDrawn in both classes; both added to the UIKit classes in ui-sample.sh.
- [x] Measured 3 of 3 each, with the assertion.
- [x] Review round 1 (bounded at 1).
- [ ] Proof, PR after #8281 merges and this is rebased.
