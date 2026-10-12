# queuebound-5907: the suite queue's bound fits the runs it waits behind (kosmos#5907 follow-up 1)

## Problem
In the suite queue the front waiter gives up when no waiter ahead has left for the bound (default 2700 s, from #4574,
which sized it from "a full suite takes 14 to 26 minutes"). A refusal sends the waiter to the back of the queue.

## Measured
TURN to END of 380 queued-heavy logs on Agent1s, 09-30 to 10-12 (comment 6122599341 on #5907):
- full browser-checks: n 50, median 74.2 min, p90 81.1, **50 of 50 over 45 min**
- full validation: n 43, median 22.2, p90 47.3, 6 over 45
So the front waiter behind any full browser-check run always gave up. #5137's 03:01 refusal tonight was one.
Tail: over 90 min, 3 browser-check runs (99.4, 99.9, 129.4) and 1 validation (151.4). 105 min covers 91 of 93.

## Change
- `tools/lib/cut-guard.sh` `kosmos_wait_until_clear`: queue default 2700 -> 6300 s (105 min), with the measurement beside it.
  The ceiling (four bounds plus one per waiter ahead) derives from it: 7 h plus 105 min per waiter. Kept scaling on
  purpose: a waiter k deep in a healthy queue waits about k holders of ~75 min, which 45 x (4+k) cuts off from k = 3.
- The queue note: the 14-26 sentence is gone; it states 105 minutes and the history.
- `KOSMOS_QUEUE_STARVE_S` stays 2700: it is the aging line at which a heavy waiter passes light ones, a different
  question. Only its comment changes (it no longer says it is the queue's bound).
- `tools/run-tests.sh`: its description says 105 minutes.
- `tools/test-cut-guard.sh`: the default-bound pin is 211 calls (210 waits of 30 s), was 91.

## Cost
Behind a genuinely hung holder the waiter k deep gives up at about (k+1) x 105 min, not (k+1) x 45 (the #4574 note).

## Weakest premise
The 380 logs are what agents left in these folders; Mortals is not in them; p90 rests on 43 and 50 samples.
Would change it: a hung-holder jam that a 105-min bound would have made materially worse.

## Not verified directly
A direct probe of the default (calling kosmos_wait_until_clear with a refusing check) was denied in this session; the
pinned test in test-cut-guard.sh covers it in the full validation.
