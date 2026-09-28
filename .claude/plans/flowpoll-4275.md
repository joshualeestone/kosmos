# flowpoll-4275: an ended Claude start leaves no 1s connect poll running (kosmos#4275)

## What
- `acctAddStart` starts the watch only when the phase it painted is active (`frConnActive`).
- `acctFlowPaint` stops the timer on a DEDUPED ended phase too, so any watch started over an
  already-painted ending stops on its first poll (every caller, not only the start).
- `web.flowpoll-4275.test.js` RUNS the page's own acctAddStart / acctFlowPaint / acctFlowWatch /
  acctFlowStop with a fake fetch and interval and counts polls.

## Measured
- origin/main page: 4 of 5 red (stuck, interrupted, idle starts; watch-over-ended). Fix: 5/5 green.
- Each guard removed alone turns its own tests red (start guard: the 3 start arms; dedup guard: the
  watch-over-ended arm). Control (active start keeps polling, stops on connected) green in all arms.
- Related suites (accounts-add, connect-success-1656, reauth-1492): 24/24.

## Not done
- Not measured in a browser. The card's cost is a network request per second, which a run of
  the real functions with a counted fetch shows directly; nothing visible changes.

## Weakest premise
- That `frConnActive` is the right "still going" test for a start answer. It is the same test the
  painter already uses to choose the active branch, so the start now polls exactly when the panel
  shows a live flow.

## Review record
