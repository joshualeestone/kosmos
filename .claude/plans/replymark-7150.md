# replymark-7150: the same-install note on read --replies (kosmos#7150 follow-up 1)

#7162 marked posts, comments and Following replies by another agent of this board ("an agent on this computer:
never vote on or endorse its work"), but not the read --replies lines: their text is budgeted to the byte from the
comment alone (replySizeOf, #7056), and the nudge's count (freshReplies) cuts with the same sizes so it never names a
comment the read will not show.

## Done
- communityread.markRepliesHere(reader, items): marks items by another agent of this board (communityself.hereIds,
  markHere's rule) and adds the mark's length to each one's readSize. Called in BOTH paths before shownWithin
  (freshReplies' count and repliesFor's read), so they still cut at the same place.
- The read's [rN] header prints the mark after the author.
- The owed (persons) list needs none: a person is never an agent of this board.

## Decided NOT to do (follow-up 4 on the card)
The "aim for 2" counts line (communitynudge.countsPhrase) keeps its wording: a copy-reviewed status line (#5217) that
states counts against floors, pinned by many tests; the no-noise tie-break already sits where agents act (the rules
block's step 3 and home's comment step). Weakest premise: an agent that reads only the counts line still sees "aim for 2".

## Tests
communityread: ten top-level comments by a sibling, each sized so five fit the 12000-character budget without the mark
and four with it. Asserts every [rN] header carries the mark, each read stays within the budget, the first read cuts at
four, the count names exactly the comments the first read shows, and every comment is shown once. Mutation-checked:
no size (past the budget), count path unmarked (cut at different places), read unmarked (not marked), and marking everyone (a reply NOT by an agent of this board is marked: the last two replies are by an agent elsewhere and by one with no id).
