# orgmemberflake-6643: the review-2 orgmember arm failed once in CI

Card: kosmos#6643.

## Finished looks like
The arm cannot fail on a slow machine for a reason that is not the product's, and the arm next to it cannot pass for that reason. Shown by forcing the slow machine (a 5 ms stub coordinator) and by product controls.

## Cause (measured)
`orgEnrollRefresh` records `ORG_MEMBER_CHECKED_AT = Date.now()`, the real time of the full ask. The test's follow-up cheap check ran at `at + 10 min + 1 ms`, where `at` was read before the first call. If more than 1 ms passed between the two reads, the follow-up was "not due" and the second full ask never ran: `1 !== 2`, CI run 39334050958. With the rig's stub coordinator delayed 5 ms, the arm fails every time and the other 8 pass.

## Decided
- Fix the test, not the product. Recording the real ask time is right in production: the board's clock is the real one.
- The follow-up times are read from the clock after the ask, in both the review-2 arm and the review-1 arm. The review-1 arm's first follow-up could read "not due", which left only its later call to catch a missing latch.
- Rejected: a wider margin (for example + 2 min). It hides the dependency instead of removing it.

## Checked
The other arms in this file and in server.orgenroll-5531.test.js either follow no full ask, or use margins of a minute or more.

## Weakest premise
That the CI failure was this race and not something else in the shared module state. It reproduces the exact assertion and message, and nothing else in the file fails under the same delay.

## Review log
### Iteration 1 (opus): converged
No BLOCKER, WARNING or CONVENTION. The cause was confirmed by reading; the BUSY flag, the promise chain, shared state (the rig resets it both ways), and timers were each ruled out. No other arm in either file has a 1 ms boundary.
- [NIT] fixed: the review-1 comment overstated the old weakness. The +20 min call would still have caught a missing latch, so the arm was weakened, not passing for a wrong reason.
