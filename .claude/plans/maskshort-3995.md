# maskshort-3995: #3995 gap 4, a held key cut into chunks of three characters or fewer with words between

Card: #3995 (gap 4, from #3935's review round 34). Gaps 1 to 3 merged in #4061.

## Measured before
Held Zq8vLm3pRt6wXy9kHb2nWc4d written "Zq8 and vLm and 3pR and ..." showed in full: no word walk starts under
OPENING_LEN = 4, no run reaches FRAGMENT_LEN, no run is long enough for the catch-all.

## Change (engine/secretmask.js), as it stands after review round 3
- shortChunkSpans: a second, stricter walk. It starts at a run of one to three characters (glue taken off) that
  begins a walked form the text can spell at all (a word break over the text's runs, memoised); advances only on runs
  that are exactly the form's next characters, each within SPLIT_REACH x the form's length (non-space) of the last
  run that advanced it; and masks only a WHOLE form with at least SHORT_WALK_MIN_KEYLIKE pieces that are not plain
  words or numbers, piece by piece (the piece, not a label glued to it), and only from the latest start. Its own
  budget; over it, the reply is withheld, as for the word walk.
- knownByShort: walked forms by their first 1 to 3 characters, not hex forms, and a form with its own - or _ also
  without them.

## Decided
- Completion only, no partial masking: completion is the defence against ordinary text.
- No key-like start rule (removed in round 1): it masked word passwords and missed many keys. Cost is controlled by
  spellability, false masks by the key-like-piece count, hex by leaving hex forms out of the short index.

## Weakest premise
- SHORT_WALK_MIN_KEYLIKE = 2 separates a random key from a password made of words by counting pieces that are not
  plain words. A password made of words with two mixed pieces (for example two ordinals written oddly) spelled by
  ordinary text would still be masked there. What would change it: a real guide reply that trips it.

## Not covered (also in the file)
- One character per chunk; an all-lowercase or all-uppercase key at any short chunking; a hex form in short chunks.

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

## Review round 2 (Sonnet), what changed
- BLOCKER fixed: a label glued AFTER a short chunk (Zq8-part0) hid it; shortPieces now offers the part before the
  first = - _ as well as after the last. Tested; red on the previous commit.
- BLOCKER fixed: a held 2ndFloorLounge was masked out of "the 2nd ... Floor ... Lounge" (an ordinal is not all one
  case). Ordinals count as plain words, and a completed walk masks only when at least SHORT_WALK_MIN_KEYLIKE (2)
  pieces are not plain words. Tested; red on the previous commit.
- Only the piece is masked, not a label glued to it (as the word walk's pieceSpan does). Tested.
- The spellability check's inner steps are charged, one unit per 16 (chunksOf), and the budget's comment says what
  it was measured against. The #3769 cost tests pass (charging every step withheld them).
- Deferred NIT: shortPieces offers one head and one tail per separator, not PIECE_VARIANTS_MAX of each; a chunk under
  OPENING_LEN with several labels glued on both sides is not tried every way.

## Review round 3 (Opus), what changed
- BLOCKER fixed: hex forms (0-9 a-f only) were in the short index, and a numbered guide's lone letters and digits
  spell them all, so every lone digit walked against every held value's hex and the reply was withheld. Hex forms are
  left out (named in Not covered). Tested with 100 held values and a 200-line numbered guide.
- A form with its own - or _ is also indexed without them (the word walk skips them; this walk does not). Tested.
- Only the latest start that completes a form at a given run is masked, so an earlier mention of its first
  characters no longer masks a "1" and a "2" on the way. Tested.
- The spellability check tries only the lengths some run has and is charged by the characters it slices.
- Not covered now names one character per chunk and all-lowercase keys; this plan's stale sections rewritten.
- Deferred NIT: a chunk ending in base64 padding (Zq8=) is tried only as written.

## Review round 4 (Sonnet), what changed
- plainWordRun judged a word by case shape alone, so "zqv" was a plain word and an all-lowercase random key had no
  key-like pieces and leaked in full. It now uses wordLike's calibrated vowel test for single-case letters (under three
  characters still counts as plain). Tested: an all-lowercase key in chunks of three is masked; MyPassword123 and
  2ndFloorLounge are still left in their sentences. Red on the previous commit.
- Not covered restated: one character per chunk, chunks of two, a single-case key whose chunks read as words, and a
  chunk glued to a label by + or / alone.
- Noted (inherited from pieceSpan, no exploit found): the piece's position in its run is found by endsWith/indexOf, so
  a run holding the same piece twice could mask the wrong one.

## Review round 5 (Opus), what changed
- A reply listing single characters ("A B C ... 0 1 2") made every form spellable and each lone character walked,
  so it was withheld with about 50 held values. A short walk now starts only from two or three characters (one still
  continues a walk). Tested with 200 held values; red without the rule. The cost: a key whose first chunk is one
  character is not caught (Not covered).
- Not covered stated precisely: a raw hex token (not only hex encodings), a long first chunk followed by short ones
  once the text runs past SPLIT_REACH times the key's length, and chunks of two only for a single-case key.
- Noted: iOS17iPadOS17 is masked out of "Update to iOS 17 or iPadOS 17" (two mixed pieces), matching what main already
  does for such values with a longer opening; the weakest premise's shape, recorded.
- Deferred NIT: the first path to reach a position wins, which can leave a real chunk visible (3 characters, adversarial).
