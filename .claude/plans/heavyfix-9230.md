# kosmos#9230: round-8 follow-ups from #9222

1. GET /api/heavy lists a caller's unchecked jobs to a pane named in the query. Decided: kept, and stated as advisory in
   the comment, because `end` already accepts the same pane claim and limiting it to a token would undo review round 7
   of #9222 (a pane-named agent must see what holds its places). Rejected: token-only listing.
2. The re-announce carry-over (an earlier record's start kept when ps cannot answer) is now read inside the file lock,
   so a write made meanwhile is the one seen. The drop key in live() gains `at`, so a re-announce made meanwhile
   (same agent, pid and kept since, new at) is never removed by a drop decided before it.
3. The wall-clock arm "start stops reading ... once its time is spent" keeps only its upper bound: a stall can only
   lower the count.

Tests: the carry-over arms (#9222) red when the block is removed. Weakest premise: no arm yet makes the key's `at`
matter (it needs a write between a read's verdict and its drop); reasoned, not measured.
