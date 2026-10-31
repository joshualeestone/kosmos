# kbsidelock-7645: main's red "ui tests (sample board)" (KeyboardSlideUITests.testReadHigherUpStaysWhereItWas)

## Finished looks like
CI's ui tests (sample board) job passes testReadHigherUpStaysWhereItWas on this branch, where main (9dcbad0ee9, c9853ea0a1) fails it,
and the three keyboard checks still pass locally on an iPhone 17e iOS 26.5 simulator.

## Finding
CI trace (PR #7665 run 41156064258): after KeyboardHold's first put-back the list is moved again by 499 pt every ~0.12 s, and each
re-move comes with a new 16 pt sideways shift (side lock shift 2, 4, 8). My inference (not established by SideScrollLock's comment, which notes the end hold is anchored .bottom and centred across but
never caught what gave the shift): the paired 16 pt sideways shift is the id anchor's .bottom scroll, so the re-mover is SwiftUI re-applying scrollPosition(id:anchor: .bottom) to its id at the bottom of the
keyboard-shrunk view (the check itself sets that id, KOSMOS_SAMPLE_SCROLLUP; a reader's own scroll sets it the same way), not the side lock writing a stale y (candidate a: its write reads y in the same change). Whether the anchor or iOS 26 makes the FIRST move is not settled by this; only the repeats are claimed.

## Change
The decisions live in Board (BoardLogic.swift: letGoAfterPutBack, keepPageByScroll, anchorKind), tested in ios/LogicTests. ChatView: in KeyboardHold's onPutBack, when the id anchor holds a reader's place (a message or "top"; not nil, not "end"), set positionId = nil, so the anchor
no longer pulls the list back to that message. Trace lines "keyboard hold: anchor let go" and, 0.2 s later, "keyboard hold: anchor after let go <none|top|end|a message>".

## Trade-off, accepted
Until the reader scrolls again (which sets a new anchor) the list is held by its offset alone, as on iOS 16. kosmos#7265 measured that drifting by tens of points as reads re-estimate rows above, so a reader who opens the keyboard and types without scrolling may drift that way. Re-anchoring on a real row was rejected: the anchor is .bottom, so naming any row scrolls the list to it, the very move being undone. A page of earlier messages landing above meanwhile is kept by keepAnchor (scrollTo the row that was topmost), which the iOS 17+ path always skipped and now runs only while the anchor is nil after a let-go (anchorLetGo, cleared when any row or "end" is named again, and with a fresh chat). That scrollTo on lazily drawn rows is unmeasured on iOS 17+ (kosmos#7265 measured offset holding there, not scrollTo, and the same proxy.scrollTo already takes the newest message there); the alternative, no keep at all, moves the reader a whole page. "end" is never let go: it is the keep on the newest message. Whether SwiftUI writes the binding back by itself after the nil is not known; the CI trace answers it (see Change my mind). Follow-up if drift shows: a check that lands reads after the let-go (noted in the PR).

## Rejected
- Widening the 0.8 s window: prolongs the fight, does not end it.
- Side lock writing only x: its y is read inside the same KVO change, so not stale; and it would not explain the 499 pt re-moves.

## Weakest premise
That the 16 pt shift accompanying each re-move proves the anchor is the mover. The CI run on this PR is the test: green here vs red
on main confirms it; red with the same trace refutes it.

## Change my mind
A CI trace on this branch still showing put back 499 after "anchor let go".

## Results
- Local, iPhone 17e iOS 26.5, fresh simulator (ios/tools/ui-keyboard.sh): 3 of 3 keyboard checks passed on 7392b97 (21:03 CDT). Again 3 of 3 on 89a07f9 (21:12 CDT). The decisions moved into Board (letGoAfterPutBack, keepPageByScroll, anchorKind) with LogicTests checks; ios/LogicTests/run.sh PASS 1729/1729. The final HEAD's results go in the PR.

## Not tested
- The wiring in ChatView (the idAnchor guard, setting anchorLetGo, clearing it on a named row) is covered only by the CI UI check,
  which drives the put-back itself; the LogicTests checks cover the three decisions alone.
- A page landing above while the anchor is let go (the keepAnchor scroll on iOS 17+) has no check at all.
