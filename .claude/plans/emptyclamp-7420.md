# emptyclamp-7420: an empty iPhone chat (Josh, build 22, iOS 26.7.2, 10-30 21:23)

## Finished looks like
The next empty-chat report from a phone says where the scroll was against its content (within, past the end, or before the
top), before and after the recovery, measured from the scroll view rather than from onAppear; an empty list whose scroll is
outside its content is put back at its end; and a later empty list in the same chat whose scroll is past its content's end
is put right too (not only the first), never pulling a resting reader to the newest message. The app builds and the chat's keyboard checks still pass on a fresh iOS 26 simulator.

## What the report shows
134 messages, 0 on screen, end and top not showing, at newest with the anchor on "end", keyboard down. Events: opened,
read 129 rows, the top marker appeared, a 16 pt sideways shift was put back, the end appeared and then left with nobody
scrolling, a second sideways shift was put back. "after one try: messages on screen again" is known to be false
(10-29: it counts onAppear, not drawn rows).

## Reading (reasoned, not measured)
On iOS 17+ every row is lazy and the list is held on an id. A list with no row, no top marker and no end marker in view
fits a scroll offset left outside the content after the rows' heights were re-estimated. The record has never carried the
offset or the content height, so this has not been checkable.

## Change
- ScrollBox: SideScrollLock, which already finds the chat's UIScrollView, hands it to a box the diagnostic reads.
- Board.scrollPlace (tested in LogicTests): within / past the end / before the top, with the top and end offsets.
- The report gains a line "scroll y, content, view, insets: <place>", and its after-the-try line reports the same measured
  place (plus "rows said to appear N", named as what it is) instead of "messages on screen again".
- Recovery (recoverEmpty), decided by Board.emptyRecovery (tested in LogicTests): the first (reported) empty list goes to
  the newest message as before, first putting a scroll outside its content (past the end or before the top) back at its
  end unless the person is scrolling. A later empty list in the same chat (and the 1.5 s check after the first) is put
  right ONLY when its scroll is past the content's end and nobody is scrolling: before the top may be a bounce, and a false
  empty reading (onScreen counts onAppear) must never pull a resting reader to the newest message. "Scrolling" is
  personScrolling (iOS 18+) or ScrollBox.underFinger (UIKit's tracking, dragging or decelerating, every iOS). After a direct
  offset write only, "end" is named again on the next turn (after goNewest's own put-back) in case that write made
  SwiftUI write a row into the binding, unless the person is scrolling by then. A repeat's trace line goes to the
  in-memory record too, so a later report in the same app run (a width report, or a new chat after a computer change) can
  show it under recent events; it carries no text or ids. The room suite checks the wiring by its source text.

## Rejected
- Changing the side lock's write now: the record shows it firing, but #7575's report found it was not the cause on 10-29,
  and without the offset numbers any change there is a guess.
- More rows on screen by eager drawing: undoes #7265 (the reason the id anchor exists).

## Weakest premise
The premise is that the empty list is an offset outside the content. The simulator measurement at the end weakens it:
there, a scroll put past the end was put right before the list emptied. If the next report says "within" while empty, the cause is drawing,
not position, and the clamp does nothing (harmlessly). Either way the report now answers it.
A caveat on reading "within": UIScrollView may itself pull an offset back inside when the content or view size changes while
nobody drags, so an at-rest "within" while empty does not by itself prove the cause is drawing; it shows the offset was
not outside at that moment.

## Not tested
- The first recovery's "before the top" arm is likely unreachable from diagCheck, which requires the top marker not to show
  (a scroll above the top shows it).
- The empty state itself has never been reproduced off Josh's phone; the clamp is unexercised by any check.
- Recovery runs only from the existing empty-list check (diagTick: when the last row leaves, 2 s after the chat shows or
  comes back, and the never-drew timer).
- A recovery inside KeyboardHold's window right after the keyboard shows: goNewest bumps appMoves, which stands the hold
  down at its next update; the race is that update against the hold's deferred put-back (narrow).

## Results
- ios/tools/ui-keyboard.sh on a fresh iPhone 17e (iOS 26.5): 3 of 3 passed on 7e92b81 (21:48 CDT); the app built.
- iOS logic suites: run.sh and every run-*.sh; room failed 1 on 7e92b81 (a source check naming the old SideScrollLock call),
  fixed in the next commit.

## Measured 22:5x CDT: a scroll past the end does not empty the chat on the simulator
Experiment (not shipped; patch kept at ~/.cache/angel-scratch/roomkb/pastend-experiment): a Debug hook put the long sample
chat's scroll 2000 pt past its content's end 6 s after opening, and a UI check waited for the empty-list line. Both arms
(fix, and NOCLAMP control) failed the same way: the empty list was never detected. The full trace shows why: after "debug:
scroll put past the end" no row and no end marker ever left the screen, so the list was put right (by SwiftUI's anchor on
"end" or by UIKit) before anything saw it empty. So on the simulator an offset past the end does NOT reproduce Josh's empty
chat, which weakens this branch's leading reading; the new report line is what will say where his scroll actually was. The
clamp stays (harmless when within), the UI check was dropped because it could not exercise the recovery.
- The report is built at the first (0.5 s) check and its after-the-try line at 0.6 s; the same tick's 1.5 s check can make
  a second, silent recovery (past the end only) that the shared report does not show.
- KeyboardHold is being reworked in #7645 (it will hold the reader's row, not the offset); this branch's note about a
  recovery inside the hold's window should be re-read once that merges.

## Final results (the code that ships, b05c9ab4de)
- ios/tools/ui-keyboard.sh on a fresh iPhone 17e (iOS 26.5): 3 of 3 passed (started 23:20:49 CDT, after b05c9ab4de was
  committed at 23:19); the app built.
- ios/LogicTests: run.sh PASS 1739/1739, run-room.sh PASS 742/742.
- Full validation (tools/run-tests.sh): first run red in one shell test (tools/test-queued-heavy-4977.sh, a queue tool's
  test, killed under a 1-minute load of 165 on 12 cores); alone it passed 142/142, and the re-run passed (25964 node tests,
  0 failed; hash 5c24d3942457).
