# dmsettle-7609: a DM reader higher up keeps their message when the keyboard comes up on a slow runner

Card: kosmos#7609 (reopened 10-31 05:0x CDT). Follows #7666 (kbsidelock-7645, merged 3d4938ee01).

## Why
Since #7666, KeyboardSlideUITests.testReadHigherUpStaysWhereItWas failed twice in a row on CI (PR #7665 runs 41188087086 and
41189479005; #7665 does not touch the chat). CI's trace: the reader's message was not drawn at did-show, so the hold put the
offset back "by its last reading" (y 10534) while the rows above had been measured again (content 14008 to 15249 pt): the
message landed off the screen. Locally the same path runs, but the content grows ~65 pt, so it lands close enough.

## Finished looks like
- KeyboardHold takes an optional onRowLost. When the reader's row is not drawn at did-show and onRowLost is given, the row
  is placed by its id at an approximate place (its will-show top as a share of the band as it is with the keyboard up;
  scrollTo lines up the row's own point at that share, not its top), and 0.1 s later settled to its will-show top by its
  fresh place on the screen. With onRowLost given, a drawn row's put-back is settled the same way while the hold still
  stands (its content reading can be stale). A settle stands down on a finger, earlier messages landing, a new width, the
  hold's stand-down, the keyboard going, a new keyboard or the chat leaving the window, and stays inside the scrollable
  range (Board.settleOffset). A placed row not drawn yet is tried once more; after a placing the hold guards the settled
  row again until its window ends.
- A will-show while a keyboard is already up (between did-show and will-hide) takes no new reading: the first one stands,
  and the record says so. Before, a second will-show (focus moving to another field) took a fresh one.
- The DM passes onRowLost: the id anchor is let go first (as after any put-back, anchorLetGo), then scrollTo(id).
- The DM's KeyboardSlide checks pass locally, and the read-higher-up check passes on CI.

## Measured
- (Commit ids in this section predate the 06:4x rebase onto main; the commits are the same, renumbered.)
- The DM on this branch, iOS 26.5 simulator (iPhone 17e), first commit (c4e6181d41): read-higher-up 5/5 traced, every run
  through the new path (row not drawn at did-show, placed by id, settled by 7 pt); KeyboardSlideUITests 3/3.
- After review 1 (e44fa5c003: the lost path's stand-downs, the settle's token and bounds, the watch kept in step, the
  at-the-newest re-check, Board.bandFraction and Board.settleOffset with LogicTests): read-higher-up 5/5 traced (four placed
  by id and settled by 7 pt, one drawn row put back -36 and settled by 0), KeyboardSlideUITests 3/3; LogicTests 1750/1750,
  room 742/742.
- After review 3 (the settle one main-queue turn later, the guard re-armed after a placing, the lost path letting any anchor
  go): read-higher-up 4 of 5 traced (three placed by id, settled by 7 pt and guarding again; one drawn row put back -43 and
  settled by 0), KeyboardSlideUITests 3/3. The fifth failed in the sample, not the hold: with the Mac at load 41 the debug
  scroll-up's "rested" marker read atBottom true 0.11 s before the end left the screen, so the chat rightly kept a reader
  it believed was at the newest; the hold never ran (no will-show reading). That sample timing is the same on main.
- After review 6 (3370dedd63: the guard re-armed and ended at its window, the placing's retry, the fresh-chat guard on the
  lost path, the keyboardUp gate): read-higher-up 5/5 traced (four placed by id, settled by 7 pt, guarding again, window
  ended; one drawn row put back -43, settled by 0), KeyboardSlideUITests 3/3; LogicTests 1750/1750, room 742/742.
- The same mechanism in the room (#7654 part 2, branch roomhold-7654): read-higher-up 5/5 traced, the nine room and DM
  checks 9/9 on iOS 26.5 and 27. That is the room's evidence, not this branch's.

## Decided
- The fix that was measured on the room, not a longer hold window (the reading is wrong, not late) and not eager rows.
- Rejected: skipping the check on CI (it is the only place the large re-measure shows).
- Weakest premise: CI's runner reproduces only there. Local runs prove the place-by-id path and the settle; only CI can
  show the 1,241 pt case is fixed. The PR's own CI run is the measurement, and one green is one data point.
