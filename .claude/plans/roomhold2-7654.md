# roomhold2-7654 (was roomhold-7654): a long room on iOS 26 and 27 reaches its end, keeps a reader's place and keeps the newest post above the keyboard

Card: kosmos#7654 part 2 (a person's scroll to the end of a long room stops short on iOS 26), and the room keyboard checks
from #7645. On main after #7666 (the DM's keyboard hold), #7665 (part 1, the opening jump) and #7675 (#7609: KeyboardHold's
onRowLost, placing by id and settling, merged 0a1d2ad398). roomhold-7654 carried its own copy of that hold; this branch
takes #7675's and keeps only the room's changes (RoomView.swift, the two room UI tests, this plan).

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
  - onRowLost (#7675's): a reader's post not drawn at did-show is placed by id, the anchor let go first, and settled by
    its place on the screen. A drawn post's put-back is by its place in the content, with no settle (#7675 removed it).
- A reader at the newest post stays there when the keyboard comes up (iOS 27 had no rule for it: newest at 636, box at
  473), as the DM's keepNewestInView, reading holdAtEnd before the keyboard rises.
- RoomOpensAtNewestUITests' scrolled-up-at-once check says what it now checks: under the anchor nothing retries, so it
  guards that the anchor does not pull an early scroller back. #7665's 2.3 s retry list (iOS 18 and later) and the scroll
  cancel are now unreachable, since the anchor covers iOS 17 and later; left in place, named here, for the review to rule on
  (removing them changes #7665's code inside this PR).

## Measured (simulator, 10-31)
- This branch's code (the room's changes on #7675's hold, 1829758f8d before the rebase onto main): the nine room and DM
  keyboard checks 9/9 on iOS 27 (iPhone 17e) AND 9/9 on iOS 26.5 (iPhone 17e), in one run each. So the room passes
  without the drawn-post settle roomhold-7654 had.
- Before that, on roomhold-7654's own hold copy: read-higher-up 12 of 13 on iOS 26.5 (one untraced failure), 9/9 on 27.
- Control: #7665 alone fails testRoomNewestStaysAboveTheBox on iOS 27 (newest at 636, box at 473).

## Not in scope
- iOS 17 and 18: they run the anchor too, but no simulator runtime is on this Mac. Named as unmeasured.
- The cause of iOS 26's estimated heights; this works with them rather than removing them.

## Decided
- Anchor plus the DM's hold, not eager rows (eager last-40 rows: part-2 check timed out, 10-30) and not position retries
  beside the anchor (measured: they fight it, the cancel check hung).
- KeyboardHold is #7675's, unchanged here; the room passes onRowLost as the DM does.
- Weakest premise: a single full run on each iOS since moving onto #7675's hold. The room's content readings go stale as
  the keyboard rises (500 to 3,000 pt, measured), and #7675 removed the settle that corrected a drawn post's put-back; the
  room passed without it, but on one run per iOS. Review round count bounded at 8 (fleet cap).

## Review round 1 (10-31, opus): what changed and what was left
- W1 fixed: toEnd and toRow bump a new appMoves (as the DM's), and it is part of the hold's moves key, so a Post, a new
  post, the working line or a reply jump inside the 1.5 s hold window is not put back by the hold. Kept apart from
  endJumps on purpose, so these jumps do not cancel goEnd's opening retries (iOS 16 only).
- W2 fixed: the dead XCTExpectFailure options removed from RoomKeyboardUITests; header says both pass now. Decided: NOT
  added to ios/tools/ui-sample.sh yet (CI's slower runner stopped this room short once, round 3; one run per iOS here is not
  evidence it holds there). Reversible in one line; a follow-up after a CI run of it by hand.
- W3, named not measured: eight jump paths moved onto toEnd/toRow (Post, new post, working line, search clear, archive
  close to archiveBoundary or the end, reply jump, older page keeping its top row, page load). Only the keyboard checks
  and the opening/read-higher checks drive them. The reply jump, the archive close and the older page are unmeasured under
  the id anchor; the second weakest premise after the one above.
- NITs: toRow leaves the anchor nil until the next toEnd (by design: holding the anchor would pull the list back to its old
  row; the next toEnd sets it). Comments for "animated", endRetries and the debug scroll-up now say which iOS they describe.
  Left: the room's hold traces land in the DM's diagRing under the DM's label, and the room read-higher test runs without
  KOSMOS_SAMPLE_TRACE. Both diagnostic-only; go on #7688's sibling card if a later round raises them again.
