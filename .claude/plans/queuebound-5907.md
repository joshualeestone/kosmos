# queuebound-5907: the suite queue's bound fits the runs it waits behind (kosmos#5907 follow-up 1)

## Problem
In the suite queue the front waiter gives up when no waiter ahead has left for the bound (default 2700 s, from #4574,
which sized it from "a full suite takes 14 to 26 minutes"). A refusal sends the waiter to the back of the queue.

## Measured
TURN to END of 380 queued-heavy logs on Agent1s, 09-30 to 10-12 (comment 6122599341 on #5907):
- full browser-checks: n 50, median 74.2 min, p90 81.1, **50 of 50 over 45 min**
- full validation: n 43, median 22.2, p90 47.3, 6 over 45
So the front waiter behind any full browser-check run always gave up. #5137's 03:01 refusal tonight was one.

## Change
- `tools/lib/cut-guard.sh` `kosmos_wait_until_clear`: queue default 2700 -> 5400 s, with the measurement beside it.
  The ceiling (four bounds plus one per waiter ahead) derives from it and scales with it.
- The queue note: the 14-26 sentence is gone; it states 90 minutes and the history.
- `KOSMOS_QUEUE_STARVE_S` stays 2700: it is the aging line at which a heavy waiter passes light ones, a different
  question. Only its comment changes (it no longer says it is the queue's bound).
- `tools/run-tests.sh`: its description says 90 minutes.
- `tools/test-cut-guard.sh`: the default-bound pin is 181 calls (180 waits of 30 s), was 91.

## Cost
Behind a genuinely hung holder the waiter k deep gives up at about (k+1) x 90 min, not (k+1) x 45 (the #4574 note).

## Weakest premise
The 380 logs are what agents left in these folders; Mortals is not in them; p90 rests on 43 and 50 samples.
Would change it: a hung-holder jam that a 90-min bound would have made materially worse.

## Not verified directly
A direct probe of the default (calling kosmos_wait_until_clear with a refusing check) was denied in this session; the
pinned test in test-cut-guard.sh covers it in the full validation.
