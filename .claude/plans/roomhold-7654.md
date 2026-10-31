# roomhold-7654: a long room on iOS 26 and 27 reaches its end, keeps a reader's place and keeps the newest post above the keyboard

Card: kosmos#7654 part 2 (a person's scroll to the end of a long room stops short on iOS 26), and the room keyboard checks
from #7645. Stacked on #7666 (the DM's keyboard hold, merged 3d4938ee01) and #7665 (part 1, the opening jump).

## Finished looks like
- On iOS 17 and later the room is anchored on a post id, as the DM is (ChatView.idAnchor, PositionById/PositionTargets on the
  room's list). Going to the end sets the anchor to the end marker ("bottom"), through nil so a repeat is seen; nothing
  retries by position under the anchor. iOS 16 keeps today's path (position jumps and goEnd's retries).
- Every jump in the room goes through toEnd (the anchor to the end marker) or toRow (the anchor let go, then a scroll to
  the row), so no position jump fights the anchor: new post, working line, the person's own post, the magnifier, putting a
  search away, the archive opening and closing, a reply's jump, the older pages keeping the top row.
- RoomKeyboardUITests.testRoomNewestStaysAboveTheBox passes on iOS 26.5 and 27 with no XCTExpectFailure.
- A reader higher up stays where they were when the keyboard comes up (testRoomReadHigherUpStaysWhereItWas): the DM's
  KeyboardHold on the room's list, with
  - its own "at the end" input (holdAtEnd: the end marker still showing 0.1 s later), because iOS 26 shows the room's end
    marker for ~20 ms as the keyboard starts to show, which stood the hold down (traced 3 of 3);
  - above = the older pages' count, so a new post landing does not end the hold;
  - onRowLost: a reader's post not drawn at did-show is placed by id at the fraction of the band it held, and then (as
    after any room put-back) settled by its fresh place on the screen 0.1 s later. The DM passes no onRowLost and keeps
    its path.
- A reader at the newest post stays there when the keyboard comes up (iOS 27 had no rule for it: newest at 636, box at
  473), as the DM's keepNewestInView, reading holdAtEnd before the keyboard rises.
- RoomOpensAtNewestUITests' scrolled-up-at-once check says what it now checks: under the anchor nothing retries, so it
  guards that the anchor does not pull an early scroller back. #7665's 2.3 s retry list (iOS 18 and later) and the scroll
  cancel are now unreachable, since the anchor covers iOS 17 and later; left in place, named here, for the review to rule on
  (removing them changes #7665's code inside this PR).

## Measured (simulator, 10-31)
- iOS 26.5 (iPhone 17e): the nine room and DM keyboard checks 9/9 in four full runs; read-higher-up 12 of 13 traced or
  full since place-by-id (one untraced failure, cause unknown).
- iOS 27 (iPhone 17e): 9/9 in one full run. Control: #7665 alone fails testRoomNewestStaysAboveTheBox there.
- DM control on 26.5 with #7666's hold: read-higher-up 3/3 (its content grows ~65 pt as the keyboard rises; the room's
  grows 500 to 3,000 pt, which is why the room needs the place-by-id and settle steps).

## Not in scope
- iOS 17 and 18: they run the anchor too, but no simulator runtime is on this Mac. Named as unmeasured.
- The cause of iOS 26's estimated heights; this works with them rather than removing them.

## Decided
- Anchor plus the DM's hold, not eager rows (eager last-40 rows: part-2 check timed out, 10-30) and not position retries
  beside the anchor (measured: they fight it, the cancel check hung).
- KeyboardHold gains an optional onRowLost and a room-only settle; the DM's behaviour is unchanged (it passes nil).
  Rejected: settling the DM too (not measured to need it, and #7666 converged after 26 rounds).
- Weakest premise: the 0.1 s settle reads the row's fresh place after iOS's own moves have finished. A later move by iOS
  (after 0.1 s, while the hold's window is open) is answered only by the hold's own row watch.
