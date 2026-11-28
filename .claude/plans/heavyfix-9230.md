# kosmos#9230: round-8 follow-ups from #9222

1. GET /api/heavy lists a caller's unchecked jobs to a pane named in the query. Decided: kept, and stated as advisory in
   the comment, because `end` already accepts the same pane claim and limiting it to a token would undo review round 7
   of #9222 (a pane-named agent must see what holds its places). Rejected: token-only listing.
2. The re-announce carry-over (an earlier record's start kept when ps cannot answer) is now read inside the file lock,
   so a write made meanwhile is the one seen. The drop key in live() gains `at`, so a re-announce made meanwhile
   (same agent, pid and kept since, new at) is never removed by a drop decided before it.
3. The wall-clock arm "start stops reading ... once its time is spent" keeps only its upper bound: a stall can only
   lower the count.

4. Not done: the card's parity NIT (the Windows verbHeavy sends no from_pane). A Windows agent normally has a token, and
   Windows-side changes go to Homer; it stays on the card for him.

Tests: the carry-over arms (#9222) red when the block is removed. A new arm re-announces from inside a read (the
injected startOf runs before live() takes the lock), so a drop decided before the re-announce must spare it; removing
`at` from the key reds it (review round 1 found the way in).

Not pinned by a test: that the carry-over read is now inside the lock. The window it closes is between the old
outside-the-lock read and locked(), and no seam reaches it: the injected startOf runs before both the old and the new
read, so a write made from inside it is seen by either; a seam inside the lock would need a re-entrant lock. So that
half rests on reading the code (one `here` under the lock serves the cap, the carry-over and the since check), and a
revert of it would pass every arm. Rejected: adding a test-only hook between startOf and the lock for one line.
