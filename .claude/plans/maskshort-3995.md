# maskshort-3995: #3995 gap 4, a held key cut into chunks of three characters or fewer with words between

Card: #3995 (gap 4, from #3935's review round 34). Gaps 1 to 3 merged in #4061.

## Measured before
Held Zq8vLm3pRt6wXy9kHb2nWc4d written "Zq8 and vLm and 3pR and ..." showed in full: no word walk starts under
OPENING_LEN = 4, no run reaches FRAGMENT_LEN, no run is long enough for the catch-all.

## Change (engine/secretmask.js)
- shortChunkSpans: a second, stricter walk. It starts only at a run of one to three characters that begins a
  walked form the text can spell (see round 1; the key-like start rule was removed there); advances only on runs that are exactly
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

## Review round 1 (Opus), what changed
- BLOCKER fixed: the key-like start let a Titlecase two-letter word ("My", "Up", "Go") start a walk, so a held
  password made of words (MyPassword123) was masked out of the ordinary sentence that spells it. The start rule is
  gone; instead a completed walk whose every piece is a plain word or number (all lower, all upper, Titlecase, or
  digits) masks nothing. Tested with four such passwords; red without the rule.
- The start gate was also the cost control, and it left 14 to 33 percent of random keys uncaught (80 percent of hex
  forms, which start with digits). Cost is now controlled by spellability instead: a walk starts only when the rest
  of the form can be spelled from runs present in the text (a word break, once per form and opening, and the viable
  forms once per opening). The #3769 cost tests pass; a reply naming eyJ 100 times with ten held JWTs is unchanged.
- Glue on short chunks is taken off (_Zq8_, p0=Zq8, part-Zq8). Tested; red without it.
- The walk's block no longer sits between nonSpaceIn's comment and nonSpaceIn. Stale comments on OPENING_LEN and in
  "Not covered" reworded; the start-rule limit removed from "Not covered", two real limits named (every chunk a plain
  word or number; a first chunk of four or more followed by short chunks far apart).
- The mixed-chunk assertion now sees the last chunk (word-boundary match).
- My own test bug: the lowercase fixture was 23 characters, so its split dropped the last two and could never be
  assembled. It is 24 now, and asserts it splits whole.
- Deferred NIT: the first path to reach a position wins (as in the word walk); a coincidental path can leave a real
  chunk unmasked in a partial way.
