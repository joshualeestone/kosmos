# confirmfix-8553: the #8261 review-cap leftovers

Card: joshualeestone/kosmos#8553 (leftovers of #8261, merged as kosmos#8554).

## Calls
1. Keep: a backdated source-only write does not move the row's date behind a kept confirmer. The row's date is its
   latest evidence; a confirmer who checked today is newer evidence than an old date given for a link. Pinned by a test
   with a control (no confirmer kept: the backdated date stands). Weakest premise: someone backdating a row only to
   mark it old cannot, while a fresh confirmer holds it; changing the status still does.
2. A write that adds no confirmer (a source fix, or a writer the board could not name, reachable through
   processCaller) does not move the row's date while the row keeps a confirmer (review 1: a source fix dated today made
   a 40-day-old check read "confirmed today by ana"). With none kept, the written date stands (#6994's rule). Such a
   nameless write blanks by; naming a new status empties the confirmers. Header says so; tests pin both directions.
3. Nits: the byte-budget comment says by is not capped and the count is characters, not bytes; the "stale before the
   cap" comment says the cap alone decides when none is fresh. Left: "you" on the page and "the person" in the CLI
   (unchanged wording from before #8261).

## Tests
- Two new tests in engine/records-confirmers-8261.test.js plus a by/byPerson assert on the existing nameless-write test.
- Records, server and CLI tests: 65 pass.
