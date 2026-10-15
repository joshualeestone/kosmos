# workdecay-5635: a Claude `working` report counts as work only for the board's decay (#5635 F2, 0.7.50)

## Why (Josh's five-family report on 0.7.50, 10-15 14:18 CDT; the card's comment)
The Claude seat's summary read "behind" after a quiet night. Board record: summary 19:03Z; reports working 21:51:38, idle
21:51:55, working 21:51:56, then nothing until 15:52Z. workExcused (the freshness rule, 0.7.45 to 0.7.48) adds the time
after any busy report as work until the next report, so the trailing `working` counted ~18 h.

## Call
In workExcused, for a Claude member only, a `working` stretch counts at most to that report's time plus 30 min
(summarydue-nudge.js WORK_GAP_CAP_MS, read lazily: the cap the nudge already puts on a working gap, so the two readers of
these rows agree). A Claude turn heartbeats working once a minute while it runs tools (install/kosmos-report-hook.sh), and
selfreport.history returns every row. Review 2 moved the cap from the board's 5-min decay to 30 min: 5 undercounted a long
tool call, thinking, or a subagent run, none of which heartbeats, toward current (the wrong direction for this function).
Not capped: other runners (Antigravity and the Windows per-turn runners file one automatic working at a turn's START,
status.js #5949); waits (needs_you, blocked); the stretch before any report is known (as before).
Known cost: a stretch of over 30 min with no tool call counts 30. The 18 h case counts under an hour: current.
Rejected: the idleExcused/idleNoted change (first attempt; never fired, the board reads such a member unknown).
Weakest premise: no real Claude work goes 30 min without a tool call or a turn end.

## Evidence
- engine/projectview.test.js 38/38. New test: the F2 timeline (a heartbeat before the summary, then working, idle,
  working within 2 s, 18 h of nothing) reads worked (current); CONTROLs: the same history for a grok member stays stale
  (not capped); a trailing needs_you for 18 h stays stale (waits not capped).
- Old fixtures that held a Claude `working` stretch of 10 to 300 min with NO heartbeat rows (a shape a real Claude turn
  cannot produce) now carry a working row each minute (`beats`), and keep their original expectations (7, 40, 6 min,
  stale). Mutant (no cap, the old behaviour): exactly the new F2 test red.

## Review
- Round 1 (Opus, on the first attempt in idleExcused): BLOCKER, the fix never fired (member reads unknown); WARNING, a
  turn-start working would excuse hours. Both answered by moving the rule to workExcused, Claude only.
- Round 2 (Opus): no blocker. W1: the operator-clear assertion became vacuous under the heartbeat fixture; the filter is
  re-pinned on grok (mutant: filter removed, that test red). W2/NIT: the 5-min cap undercounted toward current and
  disagreed with summarydue-nudge's 30-min gap cap; now the same 30 min. Mutants: no cap -> F2 test red; no operator
  filter -> the grok clear test red. 38/38.
- Round 3 (Sonnet): CONVERGED, no blocker or warning. Confirmed: no circular-require hazard (lazy, call-time), span math
  sound, fixtures still mean what their comments say, the F2 test fails uncapped. NITs taken: two stale "5 min" test
  comments; the F2 bound pinned on both sides (55 to 61 min, so a different cap is seen). Left: a member with no runner is
  uncapped (Claude members always carry runner 'claude', cardRunnerOf defaults to it; round 2 checked).
