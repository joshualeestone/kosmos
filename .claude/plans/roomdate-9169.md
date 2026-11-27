# roomdate-9169: date lines in the room's text view

Card: #9169 (split from #9166 item 3).

## Finished looks like
`kosmos room <project>` (GET /api/project/:id/room?as=text) prints `-- Wed 25 Nov --` before the first row and wherever
the local day changes, in the same zone each row's time is shown in (the operator's stored zone, else the machine's).
Rows within a day are unchanged. The year appears only when it is not the current year. An empty room has no date line.
A row whose time cannot be read adds none.

## Done
- engine/messages.js: `roomDay(at, timezone, now)`, beside `roomClock`, same zone fallback, never throws. Intl supplies
  only the numbers (year, month, day in the zone); the weekday and month words come from fixed tables, so the spelling
  does not follow the platform's locale data (some builds write "Sept").
- server.js: the text arm's per-row formatter is now `rowLines`; `lines` prepends a date line when the day changes.
- tools/fed-own-e2e.js: `fedproofNextLine` skips a date line, since a post and its note are separate rows and local
  midnight can fall between them.
- server.room-dayline-9169.test.js (4 tests): roomDay unit cases (zone decides the day and the year, UTC control,
  September spelling, bad inputs, stale zone equals the machine zone); the route across two days in 2025 (one line per
  day change, none within a day, row time unchanged); the route for a current-year row (no year); the empty room.

## Verified
- New test file: 4/4 pass. CONTROL: against origin/main server.js the route test fails.
- The 27 test files that request the room's text view by `room?as=text` or use `roomClock` (a grep, so not every
  reader of the room): 547/547 pass on the first version. Every `lines[at + 1]` check among them pairs a row with an
  extra line of the same row (reactions, "has not answered", "you already answered", "you posted after"), which
  `rowLines` returns together, so a date line cannot fall between them.
- fixture-discipline, engine.reachable, tmpscope-first, server.projects, tools.fedproof-helpers-in-sync: pass.

## Decisions
- Always a date line, even for a one-day read, a `--post` read or each `--since` page: the card's complaint includes not
  knowing a single day's lines are today. Rejected: date lines only when a read spans days (leaves today unlabeled).
- Format `Wed 25 Nov`: unambiguous across locales, unlike 11-25 / 25-11.
- Rows are not re-sorted. A late post or an outside row can sort before rows of a later day, so a day can appear twice
  (Tue, Wed, Tue); each date line is still true of the row under it. Re-sorting would change the room's order.
- Weakest premise: that nothing outside tests parses the text view by line position. Searched: install/kosmos and the
  Windows CLI only print or keep the body and look for heads that still come first; fed-own-e2e was the one adjacency
  reader and is updated.
