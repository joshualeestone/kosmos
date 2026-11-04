---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0787b
diff_hash: 2b129d3b59f70192e53d0ece0229b866fae302020ebf250282e982181f3b3889
validation: passed (Mortals, full suite: 26877 tests, 0 failed, entry status clean, hash 2b129d3b59f7)
subdir_audit: passed
timestamp: 2026-11-04T01:35:46Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes (no BLOCKERs or WARNINGs)
**Total findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT (deferred: pool wording that predates this change)

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
- [STRENGTH] a rebuild into scratch copies, reading live prod 0.7.86, is byte-identical for both release/whats-new-pool.json and web/whats-new.json.
- [STRENGTH] the pool diff is exactly 10 field changes: lastProd 0.7.83 -> 0.7.86, and the five titles web/whats-new.json showed for 0.7.86 (at prod's app commit 97a8f25a34) go pending -> shown with shownIn 0.7.86; 100 items before and after.
- [STRENGTH] the cut's 1b-ii checks now pass: whats-new-check 0.7.87 rc 0 (mac 5, windows 3); prod-check rc 0 with this pool, and rc 3 with origin/main's pool (the refusal the 19:09 cut hit, so the check can say no); the offline freshness build is byte-identical.
- [STRENGTH] all five new highlights are shipped and on in origin/main (read-only app #4455/#6146, Gemini settings #6058/#6074, Following feed #5636, project summaries #6329, long-message line #5706); none held or behind an off switch.
- [STRENGTH] 0.7.84 and 0.7.85 were staging only (site repo: the only prod promotes since 11-01 are 0.7.83 and 0.7.86), so nothing else needs recording.
- [NIT] two pool lines describe less than the code now does (long messages to Claude agents go through Claude Code's paste chip since #6717; the summaries line omits the 24-hour clock rule of #5635) --> DEFERRED (pool wording, not this branch; both still true)
