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

#### Iteration 1 (sonnet, blind, 2026-09-27 23:32 CDT)
- [WARNING] web/index.html acct-code-go / acct-cancel handlers reset ACCT_FLOW_LAST but rely on a poll the start left running (an unasserted one-caller invariant). FIXED: both handlers now call acctFlowWatch() after the reset (a no-op while one runs). Pinned in web.flowpoll-4275.test.js; removing either call turns the pin red (perturbed, each arm).
- [WARNING] frConnActive is a hand copy of engine ACTIVE_PHASES, and the fix raises what rides on it. NOT CHANGED: parity is already asserted by server.connect.test.js:134, and a phase missing from the copy already stopped the poll on its FIRST paint before this change (the ended branch calls acctFlowStop), so the change adds no new failure.
- [NIT] a test comment said "every caller" when acctAddStart was the only one. FIXED (the handlers are callers now; comment reworded).
- The reviewer also mutated both guards and a stop-on-any-repeat variant; the control test caught the last.
- Validation: 79/79 across web.flowpoll-4275, web.accounts-add, web.connect-success-1656, web.reauth-1492, server.connect.

#### Iteration 2 (opus, blind, 2026-09-27 23:35 CDT)
- No BLOCKER or WARNING. The reviewer traced engine/connect.js start(): it never answers idle while a flow is still going (it writes downloading or signin-launching at once, or stuck), so the start guard cannot orphan a live flow.
- [NIT] the handler pin could be satisfied by `acctFlowWatch();` in a comment. FIXED: comments are stripped before matching, and the call must start a line. Perturbed: with the call only in a comment, the pin is red.
- [NIT] the acctFlowPaint comment named the start as the example, which no longer reaches that path. FIXED: it names the code and cancel handlers.
- Pre-existing and out of scope, as the reviewer noted: cancel says "Stopped" without checking res.ok; a poll already in flight at cancel can repaint the old phase once.
- Validation: 79/79 across the same five files.
