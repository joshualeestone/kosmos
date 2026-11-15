# confirmers-8261: a record keeps every agent that confirmed its status

Card: joshualeestone/kosmos#8261 item 1 (item 2 split to #8552). Decided on the card 11-15 (Renet Tilley, routed by
Splinter); reversible.

## Why
Project records (#6994) already keep who wrote a row (`by`, filled from the writer's card). Each write replaced it, so
a fact a second agent checked independently read as checked once (the 11-10 and 11-11 feedback).

## What
- `engine/records.js`: a row keeps `confirmers`, the distinct writers of its current status (agent names, or the
  person), oldest first, at most CONFIRMERS_MAX (5). A write that changes the status (including clearing it) starts
  the list again with its writer. A write naming nobody adds nobody. A row stored before this seeds the list from
  its `by` / `byPerson`. `view` exposes `confirmedBy`; `renderList` says "by ana and bo" / "by a, b and c".
- `by` / `byPerson` unchanged (latest writer).
- `web/index.html` `pjRecordsWho`: the Projects page's records say "by ana, you and bo"; an older board's answer
  (no confirmedBy) names its latest writer. docs/browser-checks/render-records-6994.js gains that arm.

## Not in it
- Agent instructions (defaults.js): a doctrine bump for one sentence was judged too wide.
- CLI help text (install/kosmos and the Windows CLI): left as is; the list output shows the names.

## Tests
- engine/records-confirmers-8261.test.js (8). Each rule has a mutation that reds exactly its test.
- Existing records, server, CLI and project-show tests: 105 pass.
- render-records-6994 browser check: 17 pass; the new arm fails on the old page.
- Review 1 (correct): the byte-budget comment re-measured; the person flag is forgeable by a tokenless local caller
  that sends a loopback Origin, as byPerson already was before this change (noted on the card, not changed here).
