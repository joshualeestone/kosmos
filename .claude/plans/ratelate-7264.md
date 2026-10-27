# ratelate-7264: a usage-limit row seen late is retired (kosmos#7264)

Owner: Angel. From Josh's 08:18 CDT 10-27 sighting on his laptop (board 10102026): agents read "Rate Limit, paused for
about 886 minutes" on an open account.

## Finished looks like
An idle Claude agent whose dateless limit line is still on screen after a board restart reads idle once that limit
has reset, instead of Rate Limit for good, and delivery to it is unchanged.

## Cause
A dateless reset ("resets 6pm (zone)") is timed from when the board first saw the row (`limitFirstSeen`, in memory).
A row seen on the board's first capture after a restart is `late`, and was never timed, so `retireResetLimits` kept it
for as long as it stayed in the last 25 rows: for good, on an idle agent.

## Change
`limitRetireFromOf` (retiring only) gives `retireResetLimits` the sighting and whether it was late. For a late row:
- the reset timed from the sighting, when the clock time comes round within the span after it (an upper bound: the row
  cannot have appeared after the sighting, so this is never early);
- else the occurrence before the sighting (read as the reset timed from one span before it): that reset has passed,
  so the row is retired at once;
- a row that cannot be read (an unknown zone) still gets null and is kept.
- a late entry that sees a turn footer it has not seen has its sighting moved to that capture (it stays late): a NEW
  limit printing the same words is timed from its arrival and never inherits the old sighting (review 2's blocker).
  Only a new footer moves it (challenge loop iteration 1): more rows, or the row returning after a capture without
  it, move nothing on their own, because a redraw or a scroll back reprints the old block footer and all, and moving
  on those re-capped a released row for up to a span. Residual: a new limit whose footer text repeats one already
  seen reads released (typed, never held), chosen over re-capping on every redraw.
`limitUntil` and the delivery hold keep `limitFirstSeenOf` (no time for a late row), so messages are still typed.

## Tests
engine/limitretire-5805.test.js: the late row whose reset passed is idle at once and not held; the late row whose reset
is ahead is capped until reset plus grace, then idle; the bound never retires early. #5805 review 7's fixture now
expects idle between the old row's reset (16:01) and the newer limit (17:00). Controls: both new tests fail on main.

## Weakest premise
That Josh's rows are dateless (a dated weekly line is retired by limitResetAt regardless of the restart).

## Reviews
- Round 1 (sonnet): a restart more than a span after the reset was still kept -> retired at the sighting; a test passed
  a bare number -> now takes the late path.
- Round 2 (opus): BLOCKER, a new limit with the same words inherited the late sighting and was lifted while binding ->
  re-time on a new footer; the count guard re-capped a retired row on a redraw -> removed. Real-flow tests through
  fleet.install for both scenarios and the redraw; each fails on the commit before.
- Round 3 (sonnet): a gap, a repeated footer, a footer changing in place (which re-timed a row as new and HELD
  messages) -> a late entry stays late and its sighting only moves later (new footer or more rows); a gap alone moves
  nothing, so a sleeping laptop never re-caps yesterday's row.
- Round 4 (opus): no blocker. A new limit within the 2-minute gone window inherited the sighting -> also moved when the
  previous capture lacked the row. Tests tightened (the footer-in-place arm runs before the reset).
- Accepted residual: a late DAY-kind row (a weekly limit's last day) whose reset passed reads capped up to ~24 h on an
  idle agent (before: forever). Follow-up: time it from the turn footer's "done <clock>" where it has one.
- Not taken: a dateless day-span line printed within a minute of the board's sighting with its reset ~24 h on can read
  the earlier occurrence (pre-existing on main in limitResetTimeOnlyAt; rare). Noted for a follow-up.
