# confirmers-8261: a record keeps every agent that confirmed its status

Card: joshualeestone/kosmos#8261 item 1 (item 2 split to #8552). Decided on the card 11-15 (Renet Tilley, routed by
Splinter); reversible.

## Why
Project records (#6994) already keep who wrote a row (`by`, filled from the writer's card). Each write replaced it, so
a fact a second agent checked independently read as checked once (the 11-10 and 11-11 feedback).

## What
- `engine/records.js`: a row keeps `confirmers`, the distinct writers that created the row or named its current
  status (agent names, or the person; a source-only write adds nobody, review 3), in first-confirmed order, at most CONFIRMERS_MAX (5). A write that changes the status (including clearing it) starts
  the list again with its writer. A write naming nobody adds nobody. A row stored before this seeds the list from
  its `by` / `byPerson`. `view` exposes `confirmedBy`; `renderList` says "by ana and bo" / "by a, b and c".
- Each confirmer keeps the date of its own evidence. When any confirmer is fresh, ones older than STALE_DAYS (30) no
  longer count, on a write (before the cap, so a backdated writer cannot push out a fresh one) or a read; when none is
  fresh, all are kept and the row reads stale. A repeat write refreshes the writer's date, never moves it back
  (reviews 4 and 5).
- A confirmer name longer than 80 characters (CONFIRMER_NAME_MAX) is left off the list, so its size is bounded:
  about 950 KB per project at every limit (review 6).
- The row's `confirmed` stays its latest evidence: a backdated write never moves it behind a kept confirmer (review 7:
  a stale date beside a fresh name).
- The page falls back to the latest writer only for an older board's answer (no confirmedBy at all); renderList keeps
  the same fallback for a caller handing it such an answer.
- Deferred (review 5): the row's single `confirmed` date is still the latest evidence of ANY write (the #6994 rule,
  pinned by its own test), so after a source-only write "confirmed today by ana" pairs a fresh date with ana's older
  check. Changing that date's meaning is beyond this card; the names are each a confirmation within 30 days.
- The person-forgery gap (a tokenless local caller sending a loopback Origin) is the class of #4491; noted there.
- `by` / `byPerson` unchanged (latest writer).
- `web/index.html` `pjRecordsWho`: the Projects page's records say "by ana, you and bo"; an older board's answer
  (no confirmedBy) names its latest writer. docs/browser-checks/render-records-6994.js gains that arm.

## Not in it
- Agent instructions (defaults.js): a doctrine bump for one sentence was judged too wide.
- CLI help text (install/kosmos and the Windows CLI): left as is; the list output shows the names.

## Tests
- engine/records-confirmers-8261.test.js (18). Each rule has a mutation that reds exactly its test.
- Existing records, server, CLI and project-show tests: 105 pass.
- render-records-6994 browser check: 18 pass; the several-confirmers arm fails on the old page.
- Review 1 (correct): the byte-budget comment re-measured.
