# datelessclock: the dateless limit fixture no longer depends on the wall clock

## Why
main's test run went red on e1c0c65512 (20:23Z, 15:23 CDT 10-31) with one failure, `engine/limithold-5805.test.js`
review 17, in a file that commit does not touch.

The cause is the clock change, not the time of day (Ice Cream Kitty, measured with a shifted clock, twice each: red at
15:10 and 15:54 on 10-31; green at 14:50 and 15:56 that day and at 15:10 the day before). The fixture `DATELESS` fixes
the reset at "3pm". After 3pm the next 3pm is tomorrow, and on the day before fall-back that is 25 hours away, past
DAY_LIMIT_SPAN_MS (24h05m), so no reset is read. It recurs every year for 55 minutes, and it clears by itself.

## The call
`DATELESS` reads three hours from now through the file's own `clockAt`, as its neighbours are relative to `Date.now()`.
Measured INSIDE the window: 19 of 20 at 15:28, 20 of 20 after, same tree otherwise. A run after 15:55 CDT is green with
or without this change, so it proves nothing about it.

Rejected: changing status.js. A reset past the span giving no time is its stated behaviour. Whether a real weekly limit
on the fall-back day should read 25 hours is a separate question: it fails safe (no time shown), and it is not this
change.

Not changed: `limitmsg-5805.test.js` and `limittask-5805.test.js` still declare the same `DATELESS` and never use it.

## Weakest premise
That nothing else in the suite pins a clock time this way. The review checked the limit*-5805 files, not the whole suite.
