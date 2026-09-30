# remoteoff-4743: a computer with remote access off says so when it checks in (kosmos#4743)

## Defect
Since #4731 an enrolled computer with remote access OFF still asks its standing about twice a day, with an
EMPTY body, so the coordinator does not take it for gone. The coordinator refreshes `last_seen` for it, and
the account page says "Answering now" for about two minutes after each question, although nobody can reach
that computer (Renet Tilley's card).

## Change, board half (this branch)
`engine/mac-standing.js`: with remote access off the body is `{"remote":{"on":false}}` instead of `{}`.
One bit; no other report fields go out while off (#4731 chose to send no report in that state). With the
switch on: the full report as before, or `{"remote":{"on":true}}` when no report can be built (so a computer
the coordinator marked off is cleared).
`engine/remote.js` `setOn`: every saved REAL flip (the value changed) asks the standing at once; a flip made
while a refresh is already out is told when that refresh ends (review 3) (off: the stamp is set back past the
off cadence so it is due). Without this the coordinator heard about an OFF flip up to 12 hours later, and the
account page said "Answering now" all that time for a computer just switched off (review 2).

## Coordinator half (kosmos-relay branch remoteoff-4743)
The account page reads a computer whose latest check-in said `on: false` as "Remote access off, last
heard from <when>". With that half the off bit is kept apart and never replaces the stored diagnosis. A coordinator
WITHOUT it stores the one-bit body as a report, replacing the last diagnosis (review 1 of the relay half), so
this board half should reach users only after the coordinator half is deployed.

## Tests
- `#4743: a flip while a refresh is already out is told when that refresh ends`, and `saving the switch at the
  value it already has sends nothing`: each red with its guard removed.
- `#4743: switching remote access off tells the coordinator at once, not at the next cadence (up to 12 h)`:
  after `setOn(false)` on a fresh stamp, exactly one standing question with the off body arrives.
- `#4743: a flip whose first ask was stopped is told by the next refresh`: a flip made while not enrolled (as
  during a sign-in) is told by the next refresh even after another writer stamped the standing fresh; red
  without the fix.
`engine/mac-standing.test.js`: the #4731 off-arm test now asserts the body is exactly
`{"remote":{"on":false}}`, and its control asserts the switch-on body is not that. Red with the change
removed (17 pass, 1 fail). The related suites (remote, remote-report, remote-standing-refresh,
remote-unreadable-4308, engine.reachable, fixture-discipline) pass.

## Review 4 (opus, blind): 0 blockers, 3 warnings, 4 nits
- W, taken: a flip whose own ask was stopped (busy() during a sign-in) stayed untold for up to 12 h, because
  the sign-in's own write stamped the standing fresh. A pending flip is now due at once, whatever stamp
  another writer left. A save over an unreadable settings file counts as a flip.
- W, taken: sentences here that named the page wording and a test wrongly are corrected.
- Stated, not built: a board that was already OFF when it upgrades to this keeps its off-cadence stamp, so
  its first off check-in can come up to 12 h after the upgrade; meanwhile other signed contact can still make
  the page say "Answering now". Once, and it fixes itself.

## Weakest premise
That one bit about remote access is not something #4731 meant to keep back. #4731's comment says "no
remote report" while off; this sends no report FIELDS, only the switch's state, which the computer's owner
sees on their own account page.
