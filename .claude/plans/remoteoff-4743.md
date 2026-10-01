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
`{"remote":{"on":false}}`, and its control asserts the switch-on body is not that. Each new test is red with the guard it names
removed. The related suites (remote, remote-report, remote-standing-refresh,
remote-unreadable-4308, engine.reachable, fixture-discipline) pass.

## Review 4 (opus, blind): 0 blockers, 3 warnings, 4 nits
- W, taken: a flip whose own ask was stopped (busy() during a sign-in) stayed untold for up to 12 h, because
  the sign-in's own write stamped the standing fresh. A pending flip is now due at once, whatever stamp
  another writer left. A save over an unreadable settings file counts as a flip.
- W, taken: sentences here that named the page wording and a test wrongly are corrected.
- Stated, not built: a board that was already OFF when it upgrades to this keeps its off-cadence stamp, so
  its first off check-in can come up to 12 h after the upgrade; meanwhile other signed contact can still make
  the page say "Answering now". Once, and it fixes itself.

## Review 5 (fable, blind): 0 blockers, 1 warning, 4 nits
- W, taken: when a refresh that was out ended, it cleared the pending flip BEFORE its re-ask had passed the
  early returns, so a flip told to a board that could not ask yet (a sign-in in flight) was dropped. The flag
  is now cleared only by an ask that proceeds. New test: the flip survives that sequence (red without it).
- N, taken in the relay half: `{"remote":{"on":true}}` alone (a report that could not be built) clears the
  mark but is not stored over the last diagnosis.

## Review 6 (opus, blind): 0 blockers, 2 warnings (comments, taken), 3 nits
- Two comments were false (the body shape; what makes a pending flip due); corrected.
- Stated, not built: a sign-in that switches the switch ON itself (turnOnAfterSignin, not setOn) is told at
  the next on-cadence refresh (60 s with the page open, up to 10 min), not at once. Tried a hook there; it
  broke remote.test.js's Forget-during-retire test, so it was backed out rather than forced.

## Review 7 (sonnet, blind, after a restart; ledger of reviews 1-6 is in this file only): 0 blockers, 3 warnings, 5 nits
- W, taken: resetForTests did not clear flipPending or standingRefreshInFlight, and the two slow-fetcher tests
  could leave a refresh out on a failed assertion. Both cleared in resetForTests; both tests release in finally.
- W, taken (stated): with the switch ON and no report, the board sends `{"remote":{"on":true}}`, which an OLDER
  coordinator stores over the last diagnosis (before this, that case sent `{}` and stored nothing). Order of
  shipping, required: the coordinator half (kosmos-relay `remoteoff-4743`) is deployed before any cut carries
  this board half. Both halves are mine; the coordinator deploys from the relay repo independently of a cut.
- W, taken (replaces review 6's "stated, not built"): a sign-in that switches the switch on (turnOnAfterSignin)
  now marks the flip pending, so the NEXT standing poll is due at once whatever its stamp. It does not ask
  inside the sign-in: an immediate ask there is a signed call in flight, and Forget waits for those before it
  switches off (remote.test.js "Forget switches off before it waits on the retire" goes red with it: measured
  again tonight, as in review 6). New test, with a control (already on: the poll stays on its cadence); red
  without the flag.
- Nits taken: the off stamp is set back one millisecond past the cadence (no equality edge); the comment on
  clearing the pending flip says what holds (cleared when an ask starts; one that stops early falls back to
  the 30-minute off retry), which is narrower than review 5's sentence above.
- Run: engine/mac-standing.test.js 24/24, engine/remote.test.js 120/120, engine/remote-standing-refresh.test.js
  12/12.

## Review 8 (opus, blind): 0 blockers, 3 warnings, 1 convention, 5 nits
- W (process, held): nothing in code enforces the shipping order. Held by sequencing: this board PR is opened
  only after the coordinator half is merged AND deployed, with a probe of the live coordinator recorded on the
  card (an `{"remote":{"on":false}}` standing from a test computer sets the mark on the account page's row).
- W, taken: rebased on main (#4767 / kosmos#4756 touched resetForTests and the lines after
  turnOnAfterSignin); resetForTests keeps main's addressesInFlight and this branch's two flags.
- W, taken: the "on, no report" body had no test; new test (report build throws, switch on: body is exactly
  `{"remote":{"on":true}}`), red when that case sends `{}`.
- C, taken: the comment on an ask that stops early now says what each case leaves (not enrolled: no stamp;
  unreadable: the last known state's stamp), not "the off retry".
- Nits taken: the early-stop list names its real cases; cancelledAfter's off write marks the flip too;
  turnOnAfterSignin is exported only as turnOnAfterSigninForTests; setOn says why it may ask at once (the
  person's own toggle; a Forget after it waits at most one signed call, 20 s) while the sign-in does not.
  Left: a reset at the start of each #4743 test (a leak would fail loudly, not pass).
- Run: engine/mac-standing.test.js 25/25, engine/remote.test.js 130/130 (main added tests),
  engine/remote-standing-refresh.test.js 12/12.

## Weakest premise
That one bit about remote access is not something #4731 meant to keep back. #4731's comment says "no
remote report" while off; this sends no report FIELDS, only the switch's state, which the computer's owner
sees on their own account page.
