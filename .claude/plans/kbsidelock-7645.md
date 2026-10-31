# kbsidelock-7645: main's red "ui tests (sample board)" (KeyboardSlideUITests.testReadHigherUpStaysWhereItWas)

## Finished looks like
CI's ui tests (sample board) job passes testReadHigherUpStaysWhereItWas on this branch, where main (9dcbad0ee9, c9853ea0a1) fails it,
and the three keyboard checks still pass locally on an iPhone 17e iOS 26.5 simulator.

## Finding
(History: this Finding, its Weakest premise and Change my mind are round 1's. What ships is described from iteration 15 on.)
CI trace (PR #7665 run 41156064258): after KeyboardHold's first put-back the list is moved again by 499 pt every ~0.12 s, and each
re-move comes with a new 16 pt sideways shift (side lock shift 2, 4, 8). My inference (not established by SideScrollLock's comment, which notes the end hold is anchored .bottom and centred across but
never caught what gave the shift): the paired 16 pt sideways shift is the id anchor's .bottom scroll, so the re-mover is SwiftUI re-applying scrollPosition(id:anchor: .bottom) to its id at the bottom of the
keyboard-shrunk view (the check itself sets that id, KOSMOS_SAMPLE_SCROLLUP; a reader's own scroll sets it the same way), not the side lock writing a stale y (candidate a: its write reads y in the same change). Whether the anchor or iOS 26 makes the FIRST move is not settled by this; only the repeats are claimed.

## Change
(What ships, in short: after a put-back the id anchor is let go; the keyboard hold keeps the reader's row by its place in the
content, putting the offset at the will-show offset plus how far that row moved in the content. Details: iteration 15 on.)
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
  which drives the put-back itself; the LogicTests checks cover the five decisions alone.
- A page landing above while the anchor is let go (the keepAnchor scroll on iOS 17+) has no check at all.

(Rounds 2 to 4, round 5's first change and iteration 14's reading describe code that later work replaced; iteration 15 and
after describe what ships: the offset at will-show plus the reader's row's move in the content.)

## Round 2 (21:59 CDT): CI on PR #7666 (run 41161105224)
Measured: the let-go worked. The trace shows ONE put-back (797), "anchor let go", and 0.2 s later "anchor after let go
none": no 499 pt re-moves, and SwiftUI did not name a row again. The check still failed, for a different reason: the
viewport shrank to the keyboard (390x346, 345.85) BEFORE "keyboard up" (345.92), so KeyboardHold's will-show reading was
taken after the list had already moved, and the put-back restored that moved place.

Change: KeyboardHold watches the scroll offset all the time, notes when the list's showing height (bounds less insets) gets
shorter, and keeps the last reading from before a shrink. At will-show, if the list shrank in the last 0.5 s after that
reading (same width, no keyboard already up), the hold uses it instead of the current offset. Trace: "keyboard hold: read
from before the list shrank, moved N".

Rejected: reading at the composer's focus change (SwiftUI state lands after UIKit's first-responder change, so it is no
earlier); a running "tallest height" (it goes stale when a long draft grows the box).

Weakest premise: that the shrink is visible as a smaller bounds-less-insets at the first offset change after it. If SwiftUI
moves the offset in the same pass before the height changes, the reading is taken after the move and this does nothing.
Change my mind: a CI trace with "keyboard up" after the viewport line and no "read from before the list shrank".

Round 2 review (iteration 9) changes: the decisions moved into Board (keepPreShrinkReading, usePreShrinkReading) with
LogicTests checks (PASS 1734/1734); a reader's scroll after a shrink (any shrink, not only the
keyboard's; the reading from before it is still the reader's place) drops the pre-shrink reading; the "read from before" trace fires only when the offset moved more than a point; and a
will-show that finds the list shorter with no shrink seen says so ("shorter at will-show with no shrink seen"), so the CI
record can tell a missed shrink from no shrink. A shrink is seen only at an offset change (a known limit; UIKit's bounds
are not reliably observable).
Results, round 2: ios/tools/ui-keyboard.sh 3 of 3 on b7d556fca8 (22:08 CDT); every ios/LogicTests suite PASS on b7d556fca8.
Results, iteration 9 code: ios/tools/ui-keyboard.sh 3 of 3 on 19817a21f5 (22:17 CDT).
Iteration 11: the "anchor after let go" trace now interpolates Board.anchorKind, which the room suite's allow-list names
(negative control: without the entry the room suite fails 1 of 741). A shrink is dated by the first offset change after it,
so a later no-finger move in that half second can be undone (stated in the code, accepted as narrow).

## Round 3 (22:3x CDT): CI on 19817a21f5 (run 41163492942)
Measured: no "read from before the list shrank" and no "shorter at will-show with no shrink seen" line, one put-back (713),
the anchor let go and stayed none. So the will-show reading was not taken after a move this time (the shrink did not show
in the scroll view's bounds less insets by will-show), and the row was still gone when the check looked. did-show came
1.3 s after will-show on that runner, so a move after the 0.8 s window would be put back by nothing and traced by nothing.
Change: the window is 1.5 s. Round 1 rejected widening it because it would prolong the anchor's fight; with the anchor let
go there is no fight, and a finger or the app's own move still ends the window. And a move over 40 pt in the 3 s after
did-show, outside the window and with no finger, is traced ("keyboard hold: moved after the window N"), so the next CI
record shows whether a late move is what remains.
Weakest premise: that a late move is the cause. If the next run fails with no "moved after the window" line, the row is
lost some other way (the scroll view's frame, not its offset).
The logic job's one failure on that run ("the read in the air landed while the pull waited", a stars re-sort timing check
in LogicTests/main.swift) is not this change's code; it passed on this branch's earlier CI run and locally.

## Round 4 (22:5x CDT): CI on 6ed2de8046 (run 41164781377), measurement only
Measured: one put-back (658), the anchor let go and stayed none, NO "moved after the window" line and no second put-back in
the 1.5 s window, and still the row was off the screen. So after the put-back nothing moved the offset, yet the row was
gone: either the reading taken at will-show had already moved without the shrink showing in bounds less insets, or the
offset is right and the rows under it were laid out again (estimated heights, the #7265 drift). My understanding of the
mechanism was wrong, so this round changes no behaviour: it records the scroll's offset, content height and showing height
at will-show (with the last reading's y), right after each put-back, and when the window ends ("keyboard hold: will-show /
now / window ended y N, content N, showing N"). If will-show's y differs from the last reading's y by about the move, the
reading was late; if the y matches and the content height changed, the rows were re-laid.
Results: ui-keyboard 3 of 3 on 6ed2de8046 (22:52 CDT); every LogicTests suite PASS.

## Round 5 (23:1x CDT): CI round 4 (run 41166571312) measured it; the hold now keeps the reader's ROW, not the offset
Measured: will-show y 10534 with the last reading also 10534 (the reading was NOT late), showing already 346. Then the
content grew 14008 -> 15249 pt as the rows above were measured again, iOS moved the list 1113 pt (keeping the same rows in
view), and the hold put the OFFSET back to 10534, which in the re-measured content is a different place: the hold itself
pushed the row off. So round 2's pre-shrink reading answered a problem that did not exist (removed, with its Board functions
and checks), and keeping an offset is wrong whenever heights above change.
Change: RowTops records each drawn row's top on the screen (onGeometryChange in window points, iOS 26 only, a class so
nothing redraws). At will-show the hold keeps the reader's row (Board.readerRow: the highest drawn row whose top is at or below the bar)
and its y; once the keyboard is up, each fresh reading of THAT row's y that differs by more than a point moves the offset by
the difference. If iOS's own move kept the row in place, nothing is done. A put-back is answered only by the row's next
reading, so it is never corrected twice on a stale value.
Rejected: switching the id anchor to the top row with a .top anchor (it would need the row's fraction of the view, and
changes the anchor for every reader on iOS 17+, not only iOS 26 with a keyboard).
Weakest premise: that the row's window y from onGeometryChange is current when the hold reads it. If CI shows the put-back
undershooting or oscillating, it is not.
Round 5 review (iteration 13): the put-back is now ABSOLUTE. Each row reading carries the scroll offset at the moment it
was read, and the write is that offset plus how far the row moved, so two queued readings of one move write the same value
(a relative correction could add twice). If the reader's row stops being drawn the record says so ("the row left the drawn
rows"); the hold then does nothing for that keyboard. A fresh chat clears the row readings. Round 3's "moved after the
window" trace went with the offset watch it lived in; it is not in this code. Per-frame cost on iOS 26: one dictionary
write per drawn row per scroll frame, no SwiftUI state, nothing redrawn.
Not tested (round 5): the wiring (RowTop's readings, RowTops.watch, the size and sign of the write, .global against the
window) is covered only by the CI UI check; LogicTests cover readerRow and the anchor decisions.
Iteration 14: each row reading pairs the row's top with the scroll offset read in the same layout pass (RowReading, from
onGeometryChange's transform), not later in its action. The stale cutoff is 3 s (did-show came 1.3 s after will-show on CI).
If the reader's row is not drawn at did-show, or stops being drawn while held, the hold ends for that keyboard, with a line
saying which. Readings are not kept when the hold is off (below iOS 26, or the Debug control). A move of the offset and the
content together that leaves the row's y unchanged writes nothing (moved is 0): accepted, the row is where it was.
Iteration 15: the hold keeps the reader's row's place in the CONTENT (ContentSpace, a named coordinate space on the stack)
and the offset at will-show, and puts the offset at (offset at will-show) + (how far the row moved in the content). One
SwiftUI number per reading, no pairing with UIKit's live offset; an iOS move of the offset alone puts the offset back, rows
above measured again move the offset with the row, and if iOS's own move already kept the row in place nothing is written.
The window-point top is still read, only to choose the reader's row. With no row top below the bar (one long message fills
the screen) the reader's row is the one they are inside (Board.readerRow, checked). The will-show trace now prints only when
the hold applies.
Iteration 16: if the reader's row stops being drawn (iOS moved it far off), the hold puts the offset back once by the row's
last known place in the content, then ends (it used to just end). Kept as they are, with reasons: (1) every drawn row is
read on every scroll frame on iOS 26, because the readings must already exist at will-show and a reader at rest moves no row
(gating by `hold` would leave nothing to read); the cost is one dictionary write per drawn row per frame, no state, nothing
redrawn. (2) The let-go stays: round 1 measured the id anchor re-applying itself after each offset write, and this hold still
writes the offset.
Results on the shipping design: ios/LogicTests run.sh PASS 1734/1734, run-room.sh PASS 741/741 (beb6612fe8 and after);
the local keyboard checks and CI's UI job on the final head are recorded in the PR.
Iteration 17: a row's last place in the content is kept after it stops being drawn (RowTops.last), and the not-drawn-at-
did-show fallback writes only a reading newer than will-show's (writing the will-show offset unchanged was round 4's
failure). The written offset is kept between the two ends of what can be scrolled to. The record's numbers are pinned by a
room source check. Comments say iOS 26 and later (the hold runs on 27 too, as a no-op there).
Iteration 18: when the window ends with the reader's row off its place by more than a point (a move its readings never
reported), the record says by how much ("window ended off the row's place by N").
Current, for the shipping design: LogicTests run.sh PASS 1734/1734 and run-room.sh PASS 742/742 on ed85b71d9a and after.
Not tested, current: the ChatView wiring (RowTop, RowTops.watch and .last, ContentSpace, the write's size, sign and clamp,
the let-go) is covered only by CI's UI check; LogicTests cover readerRow and the anchor decisions; nothing covers a page
landing above while the anchor is let go.
Iteration 19: one rule for a lost row, at did-show and while held: put back once by its last known place in the content
(RowTops.last, kept after it leaves), then end. (Iteration 17's "only if newer" test was wrong: an offset-only move refreshes
the reading with the same content, and skipping it left the plain iOS jump undone.) Board.readerRow takes the visible bottom
too, so a row laid out below the screen is never the reader's; the long-message fallback is checked with that shape.
RowTops.reset() for a fresh chat. LogicTests run.sh PASS 1735/1735, run-room.sh 742/742.
Iteration 20: the hold's arithmetic is Board.holdTarget (will-show offset plus the row's move in the content, clamped to
the scrollable range), with LogicTests checks for both directions of the row's move, an offset-only move, both clamps, and
short content; the CI run 4 numbers are the fixture. LogicTests run.sh PASS 1741/1741, run-room.sh 742/742.
