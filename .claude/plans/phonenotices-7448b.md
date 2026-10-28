# phonenotices-7448b: the board tells the coordinator whether it sends phone notices (#7448 with #7458)

Contract agreed with Ice Cream Kitty in Fleet Builders (m833, m835, m836); her coordinator half is relay branch
phonenotices-7458. Stacked on nopush-7448.

## Finished looks like
- Signed POST /v1/mac/phone-notices { send: !noPush() } on the default-on schedule: at start, right after a sign-in,
  then every few minutes; sent only when the value differs from what the coordinator last answered 2xx for, for this
  computer id (a Forget plus a new sign-in is a new id, reported again).
- A failure (a 404 before #7458 is deployed, a network error, a refusal) is retried on that schedule; never read as
  "notices off", never blocking. Nothing goes to Kosmos+ while it is switched off here.

## Decisions
- Rides ensureDefaultOn's schedule (already runs at start, after sign-in, and on a 5-minute wait) rather than a new
  timer. Weakest premise: after a failed turn-on the schedule backs off (up to 15 or 60 minutes), so a mark made then
  reaches the coordinator later; the board's own gate stops sends at once regardless.
- server.phonenotify-718's mint counter now counts the mint route only (the report is a signed call too).

## Verify
- engine.phonenotify-nopush-7448.test.js: once per change, a 404 retried and never read as off, a new id reported
  again, nothing while Kosmos+ is off (7 pass). The phone-notify suites: 76 pass.

## Review
- Round 1 (sonnet): 2 warnings fixed: a confirmation now needs the coordinator's own echo (#7458 answers { ok, send }), so an old catch-all 200 or an answer without it is retried, never recorded; the report is started, not awaited, so a slow coordinator never holds up the default turn-on (one report at a time). Ice Cream Kitty m837: the tunnel signs only the routes on its list; until a Mac's tunnel has /v1/mac/phone-notices it refuses locally, which is the same retried failure (tested with macRequest's real shapes). Tests: the vacuous 404 check is gone; real refusal shapes; the default-on run starts the report without waiting. server.phonenotify-718: its 14 "nothing went to Kosmos+" checks now count mints (the report is an expected signed call), and each test waits for a report in flight so none lands in the next. 77 pass.
