# dstfixtures-7721: two limit fixtures stop landing on the hour the fall-back repeats

Card: kosmos#7721. Two tests wrote a dateless reset that fell in the repeated hour on fall-back night and failed for about two hours.

## Finished looks like
Both tests pass at the two times they failed on CI (04:13Z and 05:04Z on 2026-11-01), with no product change.

## Decided
Keep the product. It reads a repeated hour as the later one deliberately, and limituntil-5805 pins that: a held line waits a little longer rather than going
into a session still capped. Rejected: reading the earliest match, as the card floated. Which one Claude means is not on the line, and the earliest is the unsafe guess.

## Weakest premise
That later is right for a person reading the time: on that one night a card can say an hour later than the true reset. What would change my mind: a report of someone waiting on it.

## Measured
Date.now shifted to both CI times: each test fails before and all 24 pass after. Real time: 24/24.
