# mask-words-3935: a held key with WORDS between its pieces is masked

Addresses #3935 (the gap #3938 / mask-separators-3769 recorded and left open). Built on
mask-separators-3769 at 4e2d987b, rebased onto main after #3938 merged (426c7711, identical content).

## Problem
The guide's output mask joins a held key's pieces only when the noise between them is characters
no key uses (| , ; . spaces) or runs of three or fewer key characters. Any run of four or more
between pieces defeated it and the whole key showed: a word row label (`| Charlie | Ab3dEf7h |`),
another filled column, a bullet's description, words around bold or backticked chunks.

## Change (engine/secretmask.js, wordSkippingSpans)
- Cut the reply into runs of key characters, with positions.
- A held form is STARTED by a run that ends with the form's opening, four characters or more.
  Ending, not only starting, so `KEY=Ab3d` starts it too.
- Walk the runs after it in order: a run that is exactly the form's next part advances it, and any
  other run is skipped as noise. EVERY reached position is kept, not only the latest, so a short
  noise run equal to the next part ("Part 1" before a piece starting with 1) cannot derail it.
- The bound is the one #3769 uses: at most 4x the form's length in non-whitespace characters from
  the first piece.
- A hit is masked from the first piece to the last, reported as split_secret.
- Forms holding a non-key character (the spaced hex) are left out, since they can never assemble.

## Cost
- Candidates come from a 4-character opening index and are grouped per opening by the character
  the next piece must start with, so a form is walked only if some run in reach begins with that
  character.
- A step budget (250,000 checks) bounds the walk. On a reply built to keep 2,000 held forms alive,
  the unbounded walk cost 9.6s of CPU; bounded, it costs about 18ms.
- A reply that exhausts the budget is WITHHELD whole (split_search_limit): a search cut short may
  have missed a key, and this file errs toward masking. The ordinary cost tests assert they do not
  reach it.
- Found, NOT this change's: on that same adversarial reply the #3938 separator copies' knownFormsIn
  costs about 600ms, the same with or without this change (805ms measured on the base branch).
  Reported on #3938.

## Tests (engine/secretmask.test.js)
- Words between pieces: word row labels, another filled column, bullets with a description,
  prose around bold and backticks, and a first piece glued after `KEY=`. No piece readable, the
  text around it kept, reported as split_secret.
- Held values only: an ordinary word-labelled table, a bullet list, and an answer naming a held
  key's known opening (sk-ant-api03) are untouched. CONTROL: the held key in a word table is
  masked.
- Derail: "Part 1" before a piece that starts with 1.
- Budget: the adversarial reply is withheld whole, in under 1500ms.
- Mutations, each on a scratch copy:

  | mutation | result |
  |---|---|
  | keep only the latest position | 3 tests red |
  | no budget | the budget test red (4.8s) |
  | opening only at a run's start | the words test red (glued case) |
  | walk removed | 4 tests red |

- server.guide-secrets-3769.test.js and engine/secretmask.test.js: 43/43.

## Review round 1
- [WARNING] the budget did not cover the look-ahead scan, and its reach grows with the form's
  length: the board holds whole files (knownsecrets.js, up to 64KB), so one 40,000-character held
  value made a reply repeating its opening cost 1.3s --> FIXED: forms over 1,024 characters are not
  walked (still masked whole by known_secret), and every run the look-ahead visits is charged. Two
  tests: the long held value (reds without the cap), and a held value at the cap whose opening
  repeats 10,000 times, withheld at the budget (reds without the per-run charge).
- [WARNING] key characters glued to a later piece hid it: a label with = (part2=Ab3d), italics
  (_Ab3d_), a trailing slash --> FIXED: each run is also tried with leading/trailing _ , a trailing
  /, and anything up to an inner = removed; the opening is looked for with trailing _ and /
  removed. Test with the reviewer's four cases; reds before the fix.
- [NIT] the budget test's margin --> the adversarial input is now 1,000 rows (it already exhausts
  the budget).
- [NIT] the non-space count was built for every reply --> built on the first opening found.
- [NIT] one opening can complete two forms, giving overlapping spans --> DEFERRED: the rebuild
  merges them; only the split_secret count can read one higher.

## Not covered (still open, named on #3935)
- pieces out of order or reversed;
- an opening piece shorter than four characters that also has words after it;
- glue other than _ , / and a label joined with = (for example a piece wrapped in + or -);
- held forms over 1,024 characters split into pieces (whole files; not a key);
- a key split across two replies (the mask is per message).

## Weakest premise
That the first piece carries the key's opening, four characters or more. A key cut into 3-character
chunks with word labels between them still shows.
