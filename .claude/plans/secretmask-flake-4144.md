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
