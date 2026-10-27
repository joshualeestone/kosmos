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
`limitUntil` and the delivery hold keep `limitFirstSeenOf` (no time for a late row), so messages are still typed.

## Tests
engine/limitretire-5805.test.js: the late row whose reset passed is idle at once and not held; the late row whose reset
is ahead is capped until reset plus grace, then idle; the bound never retires early. #5805 review 7's fixture now
expects idle between the old row's reset (16:01) and the newer limit (17:00). Controls: both new tests fail on main.

## Weakest premise
That Josh's rows are dateless (a dated weekly line is retired by limitResetAt regardless of the restart).
