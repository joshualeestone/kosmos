# workdecay-5635: a Claude `working` report counts as work for at most 30 minutes (#5635 F2, 0.7.50)

## Why (Josh's five-family report on 0.7.50, 10-15 14:18 CDT; the card's comment)
The Claude seat's summary read "behind" after a quiet night. Board record: summary 19:03Z; reports working 21:51:38, idle
21:51:55, working 21:51:56, then nothing until 15:52Z. workExcused (the freshness rule, 0.7.45 to 0.7.48) adds the time
after any busy report as work until the next report, so the trailing `working` counted ~18 h.

## Call
In workExcused, for a Claude member only, a `working` stretch counts at most to that report's time plus 30 min
(summarydue-nudge.js WORK_GAP_CAP_MS, read lazily: the same value the nudge puts on a working gap (anchored at the
report's own time here, at the previous row there)). A Claude turn heartbeats working once a minute while it runs tools (install/kosmos-report-hook.sh), and
selfreport.history returns every row. Review 2 moved the cap from the board's 5-min decay to 30 min: 5 undercounted a long
tool call, thinking, or a subagent run, none of which heartbeats, toward current (the wrong direction for this function).
Not capped: every other runner (Gemini, Grok, Muse and the Windows per-turn runners can file one working at a turn's
START; Antigravity heartbeats only on a Mac with hooks, which this reader cannot tell apart, so it is a stated gap,
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

## Review 4 (opus, Angel after the hand-over), and what changed
- No BLOCKER. WARNING: the out-of-order assertion passed with the sort removed once the cap existed: it now uses an
  uncapped (grok) member. WARNING: Antigravity on the Mac heartbeats working before every model call
  (engine/agyhooks.js), the same shape as Claude, so it is capped too (REVERTED in review 5); Gemini, Grok and Muse still file working only
  at a turn's start and stay uncapped. NIT: a subagent's tool calls most likely heartbeat, so its run is usually counted.

## Review 5 (sonnet), and what changed: Antigravity cap REVERTED
- Review 4 capped Antigravity because it heartbeats on the Mac. Review 5: only with its hooks installed (never in a
  git project) and not on Windows, where it files one working per turn; the reader cannot tell these apart, so a cap
  would cut real hours. Back to Claude only. Known gap, stated in the code: an interrupted Antigravity turn can still
  count a night as work. Controls: antigravity, gemini, muse and grok each stay stale on the F2 night.

## Review 6 (opus), and what changed
- No BLOCKER. WARNINGs: the title still said the board's (5-min) decay, and "The call" gave the pre-review-5 reason for
  Antigravity: both corrected. NIT taken: a Claude working filed 120 min before the summary with nothing after adds
  nothing (pins the cap to the report's time, not each stretch's start). Controls: antigravity, gemini, muse, grok.

## Review 7 (sonnet), and what changed
- No BLOCKER. WARNING: "CONTROL: the agent's own idle" passed either way on Claude (the capped working adds nothing):
  it now runs on grok, asserts 6 minutes, with a no-idle control reading stale. WARNING: the needs_you comment says the
  wait alone makes it stale. NIT: "same value, different anchor" instead of "the two readers agree".

## Review 8 (opus), and what changed
- No BLOCKER. CONVENTION: the "two readers agree" wording was still in workingCapMs (review 7's replace missed it):
  now "same value, anchored differently". WARNING, stated not fixed: reports are sent in the background and stamped
  on arrival, so a turn's last heartbeat can land after its idle; each such turn adds up to 30 min that did not happen
  (was: until the next report). Fixing it needs the hook to send its own event time, a separate change. NIT taken:
  the F2 bound is now 59 to 60 (a 29-min cap reads 58). Noted: a long heartbeat run can push the 64 KB history tail
  past the summary, which reads stale (the safe direction).

## Review 9 (sonnet), and what changed
- No BLOCKER. WARNING: workingCapMs sat between workExcused and its doc block; moved above it. WARNING: a Claude
  member without a working report hook files working by hand, and each is now capped too: stated as a cost. NIT: a
  member with no runner is in the uncapped controls.

## Review 10 (opus), and what changed
- No BLOCKER. WARNING: the outage bullet said the last report holds however long the outage; for Claude it now holds
  at most WORK_GAP_CAP_MS, so hours worked through an outage read as half an hour (toward current): stated there.
  NITs: the no-runner control proved nothing (untimed returns early), dropped; cost sentence names WORK_GAP_CAP_MS;
  review 4's Antigravity line marked reverted.
