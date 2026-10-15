# workdecay-5635: a Claude `working` report counts as work only for the board's decay (#5635 F2, 0.7.50)

## Why (Josh's five-family report on 0.7.50, 10-15 14:18 CDT; the card's comment)
The Claude seat's summary read "behind" after a quiet night. Board record: summary 19:03Z; reports working 21:51:38, idle
21:51:55, working 21:51:56, then nothing until 15:52Z. workExcused (the freshness rule, 0.7.45 to 0.7.48) adds the time
after any busy report as work until the next report, so the trailing `working` counted ~18 h.

## Call
In workExcused, for a Claude member only, a `working` stretch counts at most to that report's time plus the board's decay
(status.js REPORT_WORKING_DECAY_MS, 5 min, read lazily; the board already calls an older working "a claim nobody is
standing behind"). A Claude turn heartbeats working once a minute while it runs tools (install/kosmos-report-hook.sh
throttle), and selfreport.history returns every row, so a live turn always has a row inside the decay.
Not capped: other runners (Antigravity and the Windows per-turn runners file one automatic working at a turn's START,
status.js #5949: capping would drop hours of real work); waits (needs_you, blocked: long by nature); the stretch before
any report is known (unchanged, counts as before).
Known cost, in the direction Josh's 0.7.48 rule already takes (only reported work counts): one tool call, or thinking
with no tool, longer than the decay counts only to the decay.
Rejected: changing idleExcused/idleNoted (first attempt; review 1 found the board reads such a Claude member UNKNOWN, not
idle, so it never fired for the real case, and it was the wrong rule: workExcused is the one that counted the 18 h).
Weakest premise: the heartbeat interval (60 s) staying well under the decay (5 min).

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
