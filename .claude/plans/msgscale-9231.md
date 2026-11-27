# msgscale-9231 (kosmos#9231)

**Problem.** In server.msg-starting-8658.test.js, nine "paid the wait" checks (r.ms < 1500 against a 2000 ms test wait) failed under load 12 on 12 cores on Mortals (3350 and 1737 ms). That reddened a data-only change. The file passes 15/15 alone.

**Change.** Whether a message entered the start wait is now counted, not timed. The wait's own step hook (refresh, once per 100 ms step in server.js waitForRosterRow) increments `waitSteps`:
- a path that must not wait asserts 0 steps;
- the "never appears" test asserts at least 1 (the control that the count moves).

Rows that must appear during the wait appear at its first counted step (`visibleAt: 'step'`), not 300 ms later. A loaded box passed the 300 ms mark before the board looked, which voided the wait-off control and let the "waited for and placed" tests pass with the wait missing. The wait-off control is paired with the same arrangement with the wait on, which must be placed. The one remaining ceiling is scaled.

**Rejected.** Scaling the 1500 ms limits: above a scale of 1.34 they pass a real 2000 ms wait, so a regression would go green.

**Measured.**
- 15/15 clean.
- 15/15 with a 2 s busy-wait added to every /api/msg; main's file fails 9 there.
- 5 fail with the wait removed.
- 6 fail with every name made to wait.

**Weakest premise.** The checks measure the start wait only. A new slowness of another kind on those paths is no longer caught here, so the test names say "without the start wait". A stall longer than the whole 2 s wait, before its first step, would also end it with no step counted.
