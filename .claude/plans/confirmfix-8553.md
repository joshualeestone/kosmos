# confirmfix-8553: the #8261 review-cap leftovers

Card: joshualeestone/kosmos#8553 (leftovers of #8261, merged as kosmos#8554).

## Calls
1. Keep: a backdated source-only write does not move the row's date behind a kept confirmer. The row's date is its
   latest evidence; a confirmer who checked today is newer evidence than an old date given for a link. Pinned by a test
   with a control (no confirmer kept: the backdated date stands). Weakest premise: someone backdating a row only to
   mark it old cannot, while a fresh confirmer holds it; changing the status, or waiting, still does.
2. Document: a write the board could not name (no token, no pane, not the screen; reachable through processCaller)
   leaves the confirmers and blanks by. Header comment says so; a test pins it.
3. Nits: the byte-budget comment says by is not capped and the count is characters, not bytes; the "stale before the
   cap" comment says the cap alone decides when none is fresh. Left: "you" on the page and "the person" in the CLI
   (unchanged wording from before #8261).

## Tests
- Two tests in engine/records-confirmers-8261.test.js; removing the row-date rule reds both it and #8261's.
- Records, server and CLI tests: 65 pass.
