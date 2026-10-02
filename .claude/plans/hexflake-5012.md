# #5012: secretmask round-29 test drew its held hex tokens at random

## Finished looks like
`engine/secretmask.test.js` "#3995 gap 4 review round 29" passes on every run, and still fails if the short walk stops
masking a held hex token cut into 3-character chunks.

## Call
Draw the 50 held tokens from a seeded generator (the same LCG round 27 uses), not crypto.randomBytes. The masker is
right: a key whose short chunks read as plain numbers is outside the short walk by design (secretmask.js limits:
fewer than SHORT_WALK_MIN_KEYLIKE key-like chunks). A random draw that came out mostly digits landed there and failed
(CI run 36972500674, chunks 174,586,419,...). The hexdump and numbered-list parts stay random; each skips a draw that
really contains a token.

## Rejected
Loosening SHORT_WALK_MIN_KEYLIKE so digit chunks count: that rule keeps ordinary numbered text from being masked.

## Weakest premise
That the five seeded tokens (6, 9, 8, 9 and 8 of 11 chunks with a letter) stay representative of the keys this rule
is for. A held key that really is mostly digits is the documented limit, not covered here.

## Tests
The test itself, run 3 times: pass.
