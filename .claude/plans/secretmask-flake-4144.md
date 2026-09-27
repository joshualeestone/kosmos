# #4144: secretmask round 30/31 tests flaky by construction

## What finished looks like
The two #3995 round 30/31 tests in engine/secretmask.test.js give the same answer on every run, still fail when the mask shows a key's chunks with prose between, and assert the repeated plain-word case on purpose.

## Measured before building
- 3,000 random keys through round 31's layout: 4 failed the old assertion. Three were a key repeating the chunk `be`, where BOTH lines really show (by position: 0 and 8), not a double count. One (29eb92218c1414479869312490429276) showed all 16 chunks.
- Both are documented in engine/secretmask.js, not bugs: review round 11 (a repeated plain-word chunk may leave that word showing) and the "Not covered" list above #3935's walk (a key in pairs with fewer than SHORT_WALK_MIN_KEYLIKE key-like pairs; 29eb... has only 8c, since eb is two letters with a vowel and the rest are digit pairs). The same key is masked spaced, on bare lines and whole.

## Decision
Pin the keys (the card's first direction): seven with three or more key-like pairs, one at the boundary (exactly two), all chosen to pass today, each named in its failure message. Count shown chunks by position, not by value. Assert the repeated-`be` key on purpose: only the word may show. A positive control holds another key and requires all 16 chunks to show, so a blind helper fails.
Rejected: a seeded random draw (still random coverage of a documented-uncovered class, just reproducible); filtering random keys by a copy of the key-like rule (a second derivation of the mask's own rule, convention 5).

## Weakest premise
That the documented not-covered class is the intended behaviour and not a gap worth closing. Closing it is the mask owner's call; this card is the flake. A fully shown digit-heavy key with prose between is noted here and on the card for them.

## Controls (each red when applied)
- the known full-leak key added to the list: both tests fail;
- the repeated-word assertion given that key: round 31 fails;
- shownChunks made blind: the positive control fails.

## Review round 1 (decided)
- A third documented cause (the reviewer, 1,500 keys): a key whose two-character chunks also appear in the filler (411648aca761dc522d8f939f1da52025 ends 20 25; the filler says "Dec 2025") shows those chunks, because the walk runs through the filler's copy (the listed "regrouped copy's TWO-character chunks"). Named in the test comment and on the card.
- Round 30's preamble line is restored (it exercises a different path: one pinned key shows chunk 11 with it); shownChunks skips it when indexing. The positive control uses round 30's own layout.

## Review round 2 (decided, converged)
- 0 BLOCKER, 0 WARNING, 0 CONVENTION (sonnet, after opus round 1); mutation of shortChunkSpans turns all eight pinned keys red; all three causes reproduced.
- Deferred nits: the test comment's "eb and 8c" compresses the plan's classification (only 8c is key-like, as the plan says); shownChunks would throw a TypeError rather than an assertion if mask ever withheld these short texts (unreachable with one held value; a throw still fails the test).
