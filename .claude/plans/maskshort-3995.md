# maskshort-3995: #3995 gap 4, a held key cut into chunks of three characters or fewer with words between

Card: #3995 (gap 4, from #3935's review round 34). Gaps 1 to 3 merged in #4061.

## Measured before
Held Zq8vLm3pRt6wXy9kHb2nWc4d written "Zq8 and vLm and 3pR and ..." showed in full: no word walk starts under
OPENING_LEN = 4, no run reaches FRAGMENT_LEN, no run is long enough for the catch-all.

## Change (engine/secretmask.js)
- shortChunkSpans: a second, stricter walk. It starts only at a run of one to three characters that begins a
  walked form AND looks like key text (letters with a digit, or both cases); advances only on runs that are exactly
  the form's next characters, each within SPLIT_REACH x the form's length (non-space) of the last run that advanced
  it; and masks nothing unless the WHOLE form is assembled, then piece by piece. Its own budget; over it, the reply is
  withheld, as for the word walk.
- knownByShort: the walked forms by their first 1 to 3 characters, built beside knownByOpening.

## Decided
- Completion only, no partial masking: completion is the whole defence against ordinary text (a random key's every
  character, in order, out of prose, does not happen), and a partial rule would need the thresholds #3935 already
  tuned for four-character pieces.
- The key-like start: without it, 2,000 held values made the #3769 cost tests fail (every "a" in a 40KB table
  started walks). Cost: a key whose first chunk is all lowercase, all uppercase or all digits is not caught; named in
  "Not covered" and pinned by a test.

## Weakest premise
- Short chunks after the first may be words (e.g. "and" inside a key): they still advance the walk, because the
  walk tries every run; only the START must look like key text.

## Tests (engine/secretmask.test.js)
- Chunks of three with words between: masked, words kept, reported split_secret. Mixed two/three chunks with commas.
  A partial try (first half) is not masked. The lowercase-first limit, pinned. Red with the walk disabled.
- 2,000 held values on 4,000 key-like three-character runs: not withheld, under 1.5s CPU.
