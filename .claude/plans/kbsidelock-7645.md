# kbsidelock-7645: main's red "ui tests (sample board)" (KeyboardSlideUITests.testReadHigherUpStaysWhereItWas)

## Finished looks like
CI's ui tests (sample board) job passes testReadHigherUpStaysWhereItWas on this branch, where main (9dcbad0ee9, c9853ea0a1) fails it,
and the three keyboard checks still pass locally on an iPhone 17e iOS 26.5 simulator.

## Finding
CI trace (PR #7665 run 41156064258): after KeyboardHold's first put-back the list is moved again by 499 pt every ~0.12 s, and each
re-move comes with a new 16 pt sideways shift (side lock shift 2, 4, 8). A 16 pt sideways shift is the id anchor's .bottom scroll
(SideScrollLock's own comment), so the re-mover is SwiftUI re-applying scrollPosition(id:anchor: .bottom) to the message iOS 26's
keyboard move had put at the bottom, not the side lock writing a stale y (candidate a: its write reads y in the same change).

## Change
ChatView: in KeyboardHold's onPutBack, when the id anchor holds a message (not nil, not "end"), set positionId = nil, so the anchor
no longer pulls the list back to that message. Trace line "keyboard hold: anchor let go".

## Rejected
- Widening the 0.8 s window: prolongs the fight, does not end it.
- Side lock writing only x: its y is read inside the same KVO change, so not stale; and it would not explain the 499 pt re-moves.

## Weakest premise
That the 16 pt shift accompanying each re-move proves the anchor is the mover. The CI run on this PR is the test: green here vs red
on main confirms it; red with the same trace refutes it.

## Change my mind
A CI trace on this branch still showing put back 499 after "anchor let go".
