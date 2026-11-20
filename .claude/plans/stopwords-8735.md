# stopwords-8735: #8735, two low-risk cuts in "You do not stop"

## Call
Cuts A and C from my proposal on #8735 (comment of 2026-11-20 ~03:50 CST), the two marked low risk; B and D wait for a
reader. A: the definition of an item keeps Josh's two phrases, pinned in defaults.test.js as his (07:15): WHATEVER YOUR
SYSTEM CALLS IT, and the rule does not require a tracking system at all, plus the four-things example; it drops the
introduction and the list of names (card, task, ticket, issue, story, bug, checklist line). C: the note on the two states
the board cannot see keeps the rule ("Kosmos sees every other state for itself; those two it cannot see") and drops
the explanation of why. Doctrine 57.

## Stacked, deliberately
On claimhow-8735 (e5f7680079), itself on #8814. Rebased with `--onto` as each merges; doctrine-past then regenerated
from main (the v55 and v56 rows are merged in by hand from the stacked branches' tables until then) and re-pinned.

## Rejected
- B (the history of why the report commands once read as stopping) and D (the needs_you restatement): medium risk,
  written after real stops; left for a reader on the card.
- A re-read note: each removed line is replaced by a shorter line in the same place, so the plain diff is the truth.

## Measured
- pm brief 45,919 -> 45,594 (darwin), 325 characters. Ratchet 46,000 -> 45,600.
- 1,761 related tests, 0 failed, including defaults.test.js's pins of Josh's two phrases.

## Weakest premise
That the list of names taught nothing the phrase does not.
