# mask-separators-3769: a held key split by other characters is masked

Addresses #3769 (the remaining gap from Ice Cream Kitty's 15:40 re-check after #3800).

## Problem
The guide's output mask (engine/secretmask.js) masks a key the board holds however it is
encoded, and a held key split across lines or spaced one character at a time. It did not join a
held key whose pieces have other characters between them:
- split across markdown table cells: `| 0 | Ab3dEf7h |` rows
- spelled out with commas: `s,k,-,a,n,t,...`
Both were measured as leaks by Kitty.

## Change
Two more normalised copies, searched for HELD values only (never for key shapes, never against
prose), each keeping a map back to text positions so a hit is masked from its first piece to its
last:
- all key characters: every character outside [A-Za-z0-9_+/=-] removed (commas, pipes, spaces,
  semicolons, dots, tabs, line breaks);
- long runs only: runs of key characters shorter than four removed as well, because the noise
  in a table is also short key-character runs (a row number, the --- divider).
An occurrence that is contiguous in the text is left to the ordinary known_secret pass. That also
fixes a gap in the existing split check: an intact copy of a key used to exempt a split copy
elsewhere in the same message.
The position map is built from UTF-16 indices (what slice uses), not code points, so an emoji
before the key cannot shift the mask.

## Tests (engine/secretmask.test.js)
- Table cells with row numbers and a header, commas, comma-space, semicolons, spaced dots, tabs,
  and emoji before the key: no piece readable, the text around kept, reported as split_secret.
- A key intact AND split in one message: both go.
- Held values only: ordinary comma lists, tables and single letters are untouched; CONTROL: words
  that join to a held password are masked.
- Red: main fails both new tests; removing either copy fails exactly the shape it exists for.
- The 40KB table / 2000 held values cost test still passes.

## Review round 1
- [BLOCKER] no locality bound: a held value two far-apart words spelled masked everything between
  them (4065 characters in the reviewer's repro) --> FIXED: the pieces must sit within 4x the value's
  length (a table row per chunk is about 2.5x, comma-space 3x). Test with the reviewer's repro + a
  close-split control; reds without the bound.
- [WARNING, pre-existing, live] normalisedCopy's position map walked code points, so an emoji before
  a line-split key shifted the mask and left the tail showing (also on main) --> FIXED: UTF-16
  positions. Test reds on the old map.

## Review round 2
- [BLOCKER] the 4x bound measured raw distance, so column padding in an ordinary aligned markdown
  table pushed a real split over it and the whole key showed --> FIXED: the bound counts only the
  NON-WHITESPACE characters in the span. Test: an 80-column aligned table; reds on the raw-distance
  bound. The far-apart swallow test still passes (its rows are mostly pipes and colons).

## Review round 3
No new defect. [WARNING] the recorded gap is far broader than first written --> DOCUMENTED below,
follow-up card filed. [NIT] a cost test with held values at the cap --> ADDED. [NIT] nonSpaceIn
short-circuits at the bound --> DONE.

## Remaining gaps (not claimed; follow-up card #3935)
- ANY run of four or more key characters between pieces defeats both copies: a word row label
  ("| Charlie | Ab3dEf7h |"), another filled column, a bullet's description, words around bold or
  backticks. So "split across table cells" is covered only for tables whose other cells are
  numbers, dividers or empty. This is most real tables. The general fix is a different algorithm
  (tokenise, then assemble a held value from its pieces in order, skipping noise tokens, within
  the non-whitespace bound).
- chunks written out of order or reversed: the search is in-order, and reports nothing;
- a key split across two separate replies: the mask is per message.

## Weakest premise
That real splits carry little non-whitespace noise (within 4x the value) and their noise is either non-key characters or runs of
three or fewer. Everything above that line is a stated gap, not a covered case.
