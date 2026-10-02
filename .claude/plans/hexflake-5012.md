# #5012: secretmask round-29 test drew its held hex tokens at random

## Finished looks like
`engine/secretmask.test.js` "#3995 gap 4 review round 29" passes on every run, and still fails if the short walk stops
masking a held hex token cut into 3-character chunks.

## Call
Draw the 50 held tokens from a seeded generator (the same LCG round 27 uses), not crypto.randomBytes. The masker is
right: about one random 50-token set in 2,200 held a token inside one of two documented limits in secretmask.js
(measured by review 1 over 60,000 sets: 9 of 12 failing tokens were madeOfWords, which reads a hex value whose letter
runs all look like words as words and numbers and never walks it; 3 had fewer than SHORT_WALK_MIN_KEYLIKE key-like
chunks). CI run 36972500674 drew one (chunks 174,586,419,...). The hexdump part stays random and skips a draw that
really contains a token; the numbered list's 2- and 3-character items cannot hold a 32-character token in order
(3,000 random draws against the seeded tokens: 0 failures in either part).

## Rejected
Loosening SHORT_WALK_MIN_KEYLIKE so digit chunks count: that rule keeps ordinary numbered text from being masked, and it
would cover only about a quarter of the failing draws (the rest are madeOfWords).

## Weakest premise
That the five seeded tokens (6, 9, 8, 9 and 8 of 11 chunks key-like) stay representative of the keys this rule is for.
A held hex key inside either documented limit is not covered here, by design.

## Tests
The test passes. A mutant whose short walk masks nothing (shortChunkSpans returns []) shows all ten 3-character chunks
of every seeded token, so the test still catches that regression (review 1).
