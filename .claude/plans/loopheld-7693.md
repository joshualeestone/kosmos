# #7693: measure what holds the board's thread

Addresses #7693.

## What finished looks like
board.log says how long the board's thread was held in any stall over two seconds, and how much of that was blocking commands, so the next reading can name what holds it without a guess.

## Measured, 11-04 on this board (0.7.88, carries #7793)
- Blocking commands over a second: 808 s on 11-02, 348 s on 11-03, 95 s by 10:30 on 11-04. Load differs, so this is not a controlled before and after.
- Requests over 20 s: 23 on 11-02, 13 on 11-03, 18 by 10:30 on 11-04. They did not fall with the above.
- In the last three days 60 of those were GET /api/status; 5 of the 60 overlap another slow route. No community write route is among the slow requests at all.
- So the blocking commands do not explain the slow requests, and nothing on this board reproduces the reported failure.

## Change
- engine/loopheld.js: a half-second timer that fires late writes `[loop-held] N ms, M ms of it in blocking commands`. Numbers only, capped per minute, unref'd. The first tick only sets the clock; a gap of five minutes or more is a sleeping computer.
- engine/slowspawn.js: counts all wrapped time, quick calls too, for that line.
- engine/status.js snapshotUnheld: `[slow-snapshot] N ms`. Each request sharing a gather runs its own synchronous snapshot, and no log timed that.

## Decided
- A measure, not a fix. Rejected: making the snapshot async or caching it for status readers now, since nothing yet says the snapshot is what holds the board. Weakest premise: the overlap reading, because an idle route cannot show as slow, which is exactly why this measures the thread directly.
- What would change it: `[loop-held]` lines with most of the time outside blocking commands, beside `[slow-snapshot]`, point at the snapshot; no `[loop-held]` during a 20 s /api/status means that route's wait is its own, and the board is not held.
- A longer client wait stays rejected, as the card says.

## Tests
engine/loopheld-7693.test.js: fake-clock cases with controls, and one real 3 s block seen by the real timer. engine/slowspawn-7693.test.js unchanged.
