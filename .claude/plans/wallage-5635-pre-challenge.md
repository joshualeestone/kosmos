---
pre_challenge: true
method: challenge-loop
branch: wallage-5635
diff_hash: 38b5edda552c36aefdeee5fa00959c38e4027accc63ccf4b7c6e3f83c69e9810
subdir_audit: passed
timestamp: 2026-11-02T16:04:38Z
converged: false
---

## One blind review round, no blocker, findings fixed or written down, not converged

Change: a member the board reads working now whose summary is over 24 h old by the clock reads stale, with the reason.

## Round 1
- [WARN] it overrides the 0.7.48 ruling past 24 h: a seat woken after a day of no work reads stale at once. KEPT, the 0.7.83 report asks for clock age while working; written in the code and plan as a known cost.
- [WARN] the board's screen read gates the cap, which the plan had said plays no part. FIXED in the plan and the comment.
- [WARN] the turn-ends arm could never fire (its own cap is also 24 h). FIXED, removed.
- [NIT] other states (blocked, needs_you, rate_limited) are not capped: left, written in the plan.
- [NIT] the rendered words are not tested: left.
- [NIT] no test at the exact boundary, and none through overviewOf: left; the order was checked by reading, clean.
- Clean: pipeline order, CLI words on Mac and Windows through one renderer, no board page renders it, summarydue-nudge unaffected.

## Measured
projectview, project show and overview tests pass. The new test fails with the rule switched off (checked by mutation). Full suite left to CI.
