# dmsettle-7609: a DM reader higher up keeps their message when the keyboard comes up on a slow runner

Card: kosmos#7609 (reopened 10-31 05:0x CDT). Follows #7666 (kbsidelock-7645, merged 3d4938ee01).

## Why
Since #7666, KeyboardSlideUITests.testReadHigherUpStaysWhereItWas failed twice in a row on CI (PR #7665 runs 41188087086 and
41189479005; #7665 does not touch the chat). CI's trace: the reader's message was not drawn at did-show, so the hold put the
offset back "by its last reading" (y 10534) while the rows above had been measured again (content 14008 to 15249 pt): the
message landed off the screen. Locally the same path runs, but the content grows ~65 pt, so it lands close enough.

## Finished looks like
- KeyboardHold takes an optional onRowLost. When the reader's row is not drawn at did-show and onRowLost is given, the row
  is placed by its id at the fraction of the shown band it held at will-show, and 0.1 s later settled by its fresh place on
  the screen (scrollTo(id, anchor: f) lines up the row's own point f, not its top). With onRowLost given, a drawn row's
  put-back is settled the same way (its content reading can be stale).
- The DM passes onRowLost: the id anchor is let go first (as after any put-back, anchorLetGo), then scrollTo(id).
- The DM's KeyboardSlide checks pass locally, and the read-higher-up check passes on CI.

## Measured
- The same mechanism in the room (#7654 part 2, branch roomhold-7654): read-higher-up 5/5 traced, the nine room and DM
  checks 9/9 on iOS 26.5 and 27.

## Decided
- The fix that was measured on the room, not a longer hold window (the reading is wrong, not late) and not eager rows.
- Rejected: skipping the check on CI (it is the only place the large re-measure shows).
- Weakest premise: CI's runner reproduces only there. Local runs prove the place-by-id path and the settle; only CI can
  show the 1,241 pt case is fixed. The PR's own CI run is the measurement, and one green is one data point.
