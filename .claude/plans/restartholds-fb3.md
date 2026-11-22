# Fleet Builders task 3: name the restart records in the start check

## Problem
engine/storecheck.js scans every .json store in the data root, but its HOLDS table has no words for the restart
note's own records (engine/restartnote.js): board-alive.json, board-restart-note.json and, from kosmos#8866,
board-restart-history.json. A damaged one is named "it holds a record Kosmos keeps", which tells the person nothing.

## Change
Three HOLDS entries. The page takes the words from the board (web/index.html reads f.holds), so no page change.
board-restart-history.json is named before #8866 merges; until then the file never exists and the entry is unused.

## Test
engine/storecheck-8863.test.js: the three files zeroed are each named with their words and never with the
catch-all. Mutation (the three entries removed): red, restored.

## Order
Based on crashcheck-8863 (PR #8884). Rebase onto main once #8884 and #8866 merge, then PR.

## Rejected
- A separate test file: the existing #8863 file already has the fresh-root helper, and a new file must also join
  the Windows test list.
- Copying these records to last-good/: board-alive is rewritten every minute and the note is a courtesy; an older
  copy would make a stale note.

## Weakest premise
The words are mine, not read by a copy reviewer.
