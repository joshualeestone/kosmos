# remoteoff-4743: a computer with remote access off says so when it checks in (kosmos#4743)

## Defect
Since #4731 an enrolled computer with remote access OFF still asks its standing about twice a day, with an
EMPTY body, so the coordinator does not take it for gone. The coordinator refreshes `last_seen` for it, and
the account page says "Answering now" for about two minutes after each question, although nobody can reach
that computer (Renet Tilley's card).

## Change, board half (this branch)
`engine/mac-standing.js`: with remote access off the body is `{"remote":{"on":false}}` instead of `{}`.
One bit; no other report field goes out while off (#4731 chose to send no report in that state, and that
holds). With the switch on nothing changes: the full report as before.

## Coordinator half (kosmos-relay branch remoteoff-4743)
The account page reads a computer whose latest check-in said `on: false` as "Remote access is off. Checked
in <when>." With that half the off bit is kept apart and never replaces the stored diagnosis. A coordinator
WITHOUT it stores the one-bit body as a report, replacing the last diagnosis (review 1 of the relay half), so
this board half should reach users only after the coordinator half is deployed.

## Tests
`engine/mac-standing.test.js`: the #4731 off-arm test now asserts the body is exactly
`{"remote":{"on":false}}`, and its control asserts the switch-on body is not that. Red with the change
removed (17 pass, 1 fail). The related suites (remote, remote-report, remote-standing-refresh,
remote-unreadable-4308, engine.reachable, fixture-discipline) pass.

## Weakest premise
That one bit about remote access is not something #4731 meant to keep back. #4731's comment says "no
remote report" while off; this sends no report FIELDS, only the switch's state, which the computer's owner
sees on their own account page.
