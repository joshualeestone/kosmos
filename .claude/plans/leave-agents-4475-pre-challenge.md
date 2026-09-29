---
pre_challenge: true
method: challenge-loop
branch: leave-agents-4475
diff_hash: 99e8f7cad2928e42ee121efcfe9af41ef62af3846c8fbdeef2fdcb67ea007e94
validation: passed
subdir_audit: passed
timestamp: 2026-09-29T05:13:16Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (opus, sonnet, opus)
**Converged:** Yes (iteration 3 NITs only)
**Total findings:** 3 actionable WARNINGs, plus NITs
**Fixed:** 3 | **Deferred:** 0 | **Asked (awaiting user):** 0

⚠️ **Disclosures:** two validation runs were stopped by me (my own processes in this worktree only) because their code was superseded mid-run. Origin set by reading, recorded BRANCH (fail-safe).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] engine/defaults.js — the heading "Leave other agents alone" could stop a manager agent briefing its team --> FIXED (547e8a4a8): "Removing or changing another agent", plus "Messaging and briefing other agents is not affected"
- [WARNING] engine/defaults.js — the allowed removal had no supported way to do it --> FIXED (547e8a4a8): falls back to the board's Remove this agent
- [NIT] "instructions" could cover briefing --> FIXED ("the instructions Kosmos keeps for it"); [NIT] name the real board control --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] engine/defaults.js — the allowed case could only be done by calling the removal route by hand --> FIXED (fec8910c0): only through a `kosmos` command, never a route called by hand; with none yet, it ends at the board
- [NIT] a long log line --> FIXED (re-wrapped)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
- [NIT] say "(there is none yet)" for the removal command; [NIT] "the person" in a shared room; [NIT] plan line wrap
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/defaults.js | BRANCH | heading too broad | FIXED | 547e8a4a8 |
| 2 | 1 | WARNING | engine/defaults.js | BRANCH | no supported removal path | FIXED | 547e8a4a8 |
| 3 | 2 | WARNING | engine/defaults.js | BRANCH | allowed case via hand-called route | FIXED | fec8910c0 |

### Validation
- Final validation (6j) on fec8910c0: PASSED, hash 99e8f7cad292, 11612 node tests / 0 fail, shell suites clean, subdir audit clean.
- Controls measured red: the section removed (the content test and create.test.js's boot-file assertion, which is on the Windows CI list).

### Strengths
- [STRENGTH] A new heading, so existing agents are offered it through the refresh (missingFrom pinned); DOCTRINE_VERSION 17 with its fingerprint.
- [STRENGTH] Names the injection paths explicitly: a request from another agent or from anything read is never enough.
- [STRENGTH] Restart and reconfigure are gated on the person asking, not on creation, so the setup assistant's legitimate work stays possible.
