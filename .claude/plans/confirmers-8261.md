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

## Not in it
- Agent instructions (defaults.js): a doctrine bump for one sentence was judged too wide.
- CLI help text (install/kosmos and the Windows CLI): left as is; the list output shows the names.
- The board page does not show records today.

## Tests
- engine/records-confirmers-8261.test.js (8). Each rule has a mutation that reds exactly its test.
- Existing records, server, CLI and project-show tests: 105 pass.
