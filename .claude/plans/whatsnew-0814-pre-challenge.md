---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0814
diff_hash: 752df4c244fda3df45ee040f59bb56ac4c024b272bce26f69cfc1c7f9de8bce9
validation: passed (Mortals, mortals-validate.sh at 498053c6a4: 30,429 node tests, 0 failed, 0 cancelled; all four shell shards passed; hash 752df4c244fd equals this diff_hash. The first run at 8ee3be08ec failed only the #1720 browser-check gate inside the suite, fixed by the Browser-check trailer commit 498053c6a4.)
subdir_audit: passed (no subdir CLAUDE.md in the diff)
timestamp: 2026-11-22T00:25:15Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes. Round 4 raised no BLOCKER, WARNING or CONVENTION (3 NITs, one a duplicate of a deliberate decision).
**Total findings:** 0 BLOCKERs, 5 WARNINGs, 1 CONVENTION, NITs per round
**Fixed:** 4 WARNINGs, 1 CONVENTION | **Deferred:** 1 WARNING (a wording that cannot fit the window, decided in the plan) | **Asked (awaiting user):** 0

**6.0 deviation, stated:** the local validation helper was not run on Agent1s. The full kosmos suite ran on Mortals through mortals-validate.sh and is recorded locally under the same hash. After every change: `tools/whats-new-check.js 0.8.14` and the What's New test files (72 tests, 0 failed).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0
- [WARNING] the auto-balance line is not tied to Splinter's prod condition on #1050 --> FIXED (recorded on #1050: if auto-balance is turned off by default instead of #8862 landing, the line is rewritten before any promote)
- [WARNING] the feedback --unchanged line was false in PowerShell --> FIXED (41f9a6116d): "keeps a single line piped in, or says why it could not (in PowerShell, give it as words)"
- [WARNING] kosmos post --how and kosmos agent --how had no notes lines --> FIXED: two notes lines
- [CONVENTION] a title dropped the leading `kosmos` --> FIXED
- [NIT] "Claude accounts" looser than the code (subscriptions only) --> FIXED; [NIT] the Following line over-claimed --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] "idle agents" leaves out agents stopped at their limit --> DEFERRED: every wording that adds the case and keeps the trigger runs past 140 characters (145 to 161 measured); the one that fits drops the trigger and reads as if every idle agent moves. Recorded in the plan.
- [NIT] near/room approximations (the plan's weakest premise), the window's ranking, the answered-reply scope --> no change

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] the new highlight pushed "Kosmos Cloud machines update themselves" (default-on) out of the window --> FIXED (8ee3be08ec): re-ranked 8.4 to 8.05, above the apostrophe line; "Update Kosmos from the board on Linux" leaves this window, still pending
- [NIT] plan figure 132 vs 137 --> FIXED; [NIT] #8845 items 2 and 3 not recorded --> FIXED; [NIT] the feedback title lacked `write` --> FIXED ("kosmos feedback write --unchanged reads a pipe", 46 of 48)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [NIT] "idle agents" under-claims (duplicate of the iteration 2 decision); [NIT] agent --how is aimed at a PM agent; [NIT] the Cloud nightly line sits at exactly 140 characters
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | release/whats-new-pool.json | BRANCH | highlight vs the prod condition | FIXED | #1050 comment |
| 2 | 1 | WARNING | release/whats-new-pool.json | BRANCH | PowerShell feedback line | FIXED | 41f9a6116d |
| 3 | 1 | WARNING | release/whats-new-pool.json | BRANCH | post/agent --how missing | FIXED | 41f9a6116d |
| 4 | 1 | CONVENTION | release/whats-new-pool.json | BRANCH | title without kosmos | FIXED | 41f9a6116d |
| 5 | 2 | WARNING | release/whats-new-pool.json | BRANCH | idle-or-stopped wording | DEFERRED | 140-character window, plan |
| 6 | 3 | WARNING | release/whats-new-pool.json | BRANCH | Cloud nightly out of window | FIXED | 8ee3be08ec |

### Strengths
- Every line was read against the code it describes (autobalance.js thresholds, usagepoll's subscription count, the Settings switch, both CLIs).
- web/whats-new.json is the tool's own build, byte for byte; whats-new-check.js passes (5 highlights, mac 5, windows 5).
- Omissions are recorded with reasons (the iPhone wording, agent-only brief slices, #8860, #8528).
