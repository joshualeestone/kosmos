# chipwarn-9016: the composer's waiting file says when it arrived incomplete (kosmos#9016, the follow-up from slice 2)

Finished means: a file added to a chat or room composer that the Mac found cut short shows "incomplete upload, please
send again" under its name on the waiting chip, in the warning colour, while it can still be taken off and sent again
(the board's attachAdd 'cut', web/index.html). Stacked on incomplete-9016 (#9052), which defines Board.incompleteWords.

## Built
- BoardLogic.swift: Attached gains `var incomplete: Bool = false`; uploadResult reads it with Board.isTrue.
- ChatFiles.swift: FileChip gains `incomplete`; the plain chip draws the words under the name at a set 150 pt width
  (the chip is fixedSize horizontally). A picture's square is unchanged (a cut-short zip-based file has no picture).
- ChatView.swift and RoomView.swift: the composer chips pass `a.incomplete`.
- LogicTests: true is read; a number 1 is not.
