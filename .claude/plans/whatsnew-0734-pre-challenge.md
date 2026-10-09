---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0734
diff_hash: a0a6e958e5d7e0acf95548ed3724b881dd899b354b7c4e13c51a9b5a004e7ee1
validation: passed
subdir_audit: passed
timestamp: 2026-10-09T14:27:59Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (sonnet, opus, sonnet). **Converged:** yes, round 3 (one WARNING deferred with its reason in the plan; NITs).
Validation: web/whats-new.json parses; 4 highlights; titles 34-45 (limit 48), lines 105-130 (limit 140); allowed icons; no em dash.
Copy-only change; the cut's step 3b runs the full page layer on this tree.

### Per-Iteration Breakdown
1 sonnet: three overclaims (never / task list names the owner; a missed run gets done; each message read): FIXED.
2 opus: names not on screen (conversation mode, auto-assign, repeat run, deleted / you): FIXED.
3 sonnet: voice line reads unconditional: DEFERRED (the page explains the no-voice case); NITs: confirmed accurate.

## Final Ledger

### Round 3 (sonnet), as reported
[WARNING] web/whats-new.json:7 - The voice highlight reads as unconditional (no-voice computer, long messages read only their opening). DEFERRED: the button shows only where the page can speak and says why nothing plays.
[NIT] web/whats-new.json:12 - The Assigner line is scoped to automatic hand-out; accurate, no change.
[NIT] web/whats-new.json:17 - The nudge line is true; names match the board.
[NIT] web/whats-new.json:22 - The take-back line is scoped correctly; title matches the row text.
[STRENGTH] - On-screen names match web/index.html; earlier overclaims removed.
