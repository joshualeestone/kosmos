# roomhold-7645: the keyboard hold keeps a place when the jump-back leaves no row (kosmos#7645)

## Finished looks like
When the keyboard starts to show in a chat or room read higher up, and the move just before it is read back as the
keyboard's (#7690) but that read-back puts every trusted row off the screen, the hold still holds the reader's row,
read where it is now, instead of holding nothing and letting iOS move the list. The trace says which happened, with
the size of the jump, so the next CI red shows whether this was the path.

## Evidence (CI, iOS 26.5, run 41691914906 attempt 1, testRoomReadHigherUpStaysWhereItWas)
content 13038 -> 13578 -> 17138 -> 17566 while the reader scrolled up; a jump 13368 -> 13906 0.04 s before will-show;
"9 of 36 rows agree with the list", "no row on the screen to hold"; iOS then moved the room 13906 -> 16087 -> 15231 and
the reader's post left the screen. Board.readerRow returns nil only when every row is below the band, which is what a
positive read-back of ~538 pt does to rows that were on screen.

## Decided
- Fallback, not removal: #7690's read-back is right for the tap's own jump (measured 490 pt on CI). Only when it leaves
  no row does the hold read the rows where they are now, and then the saved offset uses no read-back either.
- Trace both: "a jump of N left no row to hold, read where they are now", and the size in the no-row line.
- Not a test loosening: the UI test stays as it is.

## Rejected
- Telling an estimate-driven move from the tap's by the content height changing in the same moment: the tap can also
  re-estimate (it re-lays the list), so that signal is not clean. Recorded as the next step if the fallback is not
  enough.

## Weakest premise
That the read-back caused the miss. The trace line that would prove it (the shift's size) did not exist; this branch
adds it. The other red (run 41644332550) drew no rows at all after the keyboard and printed no trace: not addressed here.
