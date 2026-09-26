# maskgaps-3995: three of the four guide-mask gaps in engine/secretmask.js

Card: #3995 (filed from #3935's review rounds 27, 29 and 34). Refs #3995, does not close it: gap 4 stays open.

## What changed
- Gap 1, a held key grouped with / + or = between chunks: fragmentsIn also tests each run with - _ + / = taken
  out (catches a grouped run of 12 or more key characters, with or without the opening), and the word walk's
  pieceVariants also offers a run with + / = taken out (catches short groups with words between them).
- Gap 3, a held value with symbols in it given without its opening (Lm3p#Rt6w$Xy9k): fragmentsIn also runs over a
  copy with the characters no key uses deleted, whitespace kept, spans mapped back.
- Gap 2, pieces spread past the reach limit: the walk's reach is counted from the last run a piece matched in,
  not from the opening. Pieces are still masked one by one, so a longer walk never swallows the text between.

## Decided
- The card's suggested change to the separator-free copy (drop + / = there too) was built and then reverted:
  with the other two changes in, no measured input needed it (each arm removed in turn; it covered nothing the
  others did not). A mechanism that covers nothing unique is decoration.
- Gap 4 (chunks of three or fewer with words between) is NOT in this change. It is #3935's documented weakest
  premise: OPENING_LEN = 4 exists so ordinary short words do not start walks. It needs its own design (a
  completion-only walk from short openings, bounded by the budget) and its own review, so it stays on the card.

## Rejected
- Adding + / = to SKIPPABLE: the variant route is narrower (it only adds candidate pieces, never widens a skip).

## Weakest premise
- Per-gap reach lets a walk keep going as long as each real piece (OPENING_LEN or more, not words) is near the last. A walk only advances on runs that
  are exactly the key's next characters, so coincidence in prose is out of reach, and the word-walk budget still
  bounds the cost; the existing cost tests pass unchanged. What would change it: a measured reply where a walk
  creeps through ordinary text on one-character matches.

## Review round 1 (Opus), what changed
- BLOCKERS fixed: per-gap reach let a walk creep on one-character matches ("a" after sk-ant-), so a guide naming
  sk-ant-api03- many times was withheld (budget) and a bare mention far before a real key was masked. Reach now
  moves only when a piece of OPENING_LEN or more, not words, takes the walk further than it has been. Tested: 160
  mentions unchanged and under 600ms CPU; the bare mention kept. Red on the previous commit.
- The unpunctuated copy masked the whole joined run (a JSON object, a CSV row, a URL glued to the key). It now
  masks only the text's own key-character runs that hold a matching slice's characters. Tested, red before.
- The three grouped-separator cases had a "Key:" label that masked them on main by another rule; dropped, and every
  case now asserts split_secret.
- Stale comments on the walk's reach and SPLIT_REACH corrected.
- Deferred (not a regression, main leaks the same): a held key with its own - or _ regrouped with + or / (its grams
  and walked form keep its own separators). Named in the file's "Not covered" list. What would change it: indexing a
  separator-stripped form too, which doubles the index for licence-style keys; a follow-up if it is ever seen.

## Tests
- engine/secretmask.test.js "#3995 ...": every case above, plus ordinary text with / + = (URLs, arithmetic,
  and/or) left alone, and one piece alone not swallowing the text after it. Red on origin/main's secretmask.js.
- Each mechanism removed in turn against a probe: variants and fragment-strip each have a case only they catch;
  the unpunctuated copy and the per-gap reach each turn their own case red.
