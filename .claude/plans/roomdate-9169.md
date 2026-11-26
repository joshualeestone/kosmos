# roomdate-9169: date lines in the room's text view

Card: #9169 (split from #9166 item 3).

## Finished looks like
`kosmos room <project>` (GET /api/project/:id/room?as=text) prints `-- Wed 25 Nov --` before the first row and wherever
the local day changes, in the same zone each row's time is shown in (the operator's stored zone, else the machine's).
Rows within a day are unchanged. The year appears only when it is not the current year. An empty room has no date line.
A row whose time cannot be read adds none.

## Done
- engine/messages.js: `roomDay(at, timezone, now)`, beside `roomClock`, same zone fallback, never throws.
- server.js: the text arm's per-row formatter is now `rowLines`; `lines` prepends a date line when the day changes.
- server.room-dayline-9169.test.js: roomDay unit cases (zone decides the day, UTC control, year, bad inputs), the route
  (two days, three rows, one line per day change, none within a day, time unchanged), the empty room.

## Verified
- New test: 3/3 pass; CONTROL against origin/main server.js: the route test fails (2/3).
- The 27 test files that read the room text: 547/547 pass.
- fixture-discipline, engine.reachable, tmpscope-first, server.projects: 216/216 pass.

## Decisions
- Always a date line, even for a one-day read (the card's "the latest post is easy to misread" includes not knowing a
  single day's lines are today). Rejected: date lines only when a read spans days (leaves today's lines unlabeled).
- Format `Wed 25 Nov` (en-GB short weekday, day, short month): unambiguous across locales, unlike 11-25 / 25-11.
- Weakest premise: that nothing parses the text view by line position. The 27 readers pass; the Windows CLI and the
  busy copy only relay the text.
