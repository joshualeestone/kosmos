# unvrow-7130: the iPhone room draws the board's "arrived while waiting" line under an unverified outside row

Card: kosmos#7130 (follow-up to #7129, Baron's board-side change, not yet merged when this was built).

## What
- BoardRoom.swift: RoomRow.unverified, set from the room route's `unverified` only when it is a real JSON true
  (Board.isTrue, as the board's `m.unverified === true`). Board.unverifiedLine is the board's sentence, verbatim.
- RoomView.swift: under an outside row's words, the line in .caption / Palette.secondary (the board's .msg-ext-unv,
  12 px, --label-2). The post is one VoiceOver element, so the line is read with it. Copy takes row.text only, so the
  line is left out, as the board's msgCopyText removes .msg-ext-unv.

## Depends on #7129
The room test pins the sentence, the exactly-true condition, the 12 px secondary style and the Copy exclusion to
web/index.html. On main before #7129 merges those three pins are RED (that is the dependency, made visible). Against
#7129's web/index.html (branch unverified-7129 @ 393c18e282) the room suite is 295/295.
Rebase onto main after #7129 merges, re-run, then validate.

## Checks so far (10:25 CDT)
- run-room 295/295 with #7129's board file swapped in for the run, 292/295 on main (the 3 pins).
- run.sh 1223, actions 99, settings 42, tasks 90, taskpage 108. Debug and KOSMOS_STORE_SHOTS Release builds.
- Broken-copy controls: parse line removed -> "unverified: true marks the row" red; one word of the sentence changed
  -> the board-sentence pin red.

## Review
- Round 1: 0 blockers, 1 warning, 2 nits. Warning fixed: the drawing itself is pinned in RoomBubble's source (the line on
  a marked outside row, .caption and secondary, under the words and before the file cards, drawn once, Copy still the
  words); deleting the drawing turns two checks red. Nit fixed: 2 pt above the line, as the board's margin-top (the
  stack's spacing is 4). Nit recorded: the fixture JSON is hand-written; the reviewer matched its shape to server.js on
  unverified-7129. Room 299/299 with #7129's board (296/299 on main, the 3 pins); Debug SUCCEEDED.
