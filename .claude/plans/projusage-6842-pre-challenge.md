---
pre_challenge: true
method: challenge-loop
branch: projusage-6842
diff_hash: bf631c1396480a7a524019862f2146a294f180f34f6cdc8f3fb04e18bc4be9eb
validation: passed except contention reds that pass alone (6g: server.phonenotify-718 #6488 and server.projects "cut listing", 227/227 alone x2; final: tools.run-tests-file-timeout-6668 #6668, 66/66 alone). This branch touches only engine/orgrollup.js, engine/orgenroll.js and their tests.
subdir_audit: passed
timestamp: 2026-10-22T02:21:46Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 12 WARNINGs actionable, plus NITs
**Fixed:** 7 | **Deferred:** 5 (each a stated residual in the plan) | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 4 WARNINGs, 4 NITs
**Self-generated:** 0 (no loop commit yet)
- [WARNING] engine/orgrollup.js fit — a size trim could empty projectUsage to [], which the coordinator reads as none and wipes the stored week --> FIXED (3c2897608; the key is deleted, a mutant fails)
- [WARNING] engine/orgrollup.js projectUsageByDay — concurrent holds can count tokens on two tasks --> DEFERRED: stated residual (applies to any sum over receipts; de-duplicating spans is a separate change)
- [WARNING] engine/orgrollup.js projectUsageByDay — no cap on tasks read --> FIXED (3c2897608; 200 newest, more marks incomplete; mutant)
- [WARNING] engine/orgrollup.js — readProjectUsage sat between readUsage's doc comment and readUsage --> FIXED (3c2897608)
- NITs: dead field, zero-token unnamed model marked truncated, an invisible right-to-left character, other-Kosmos note --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, 2 NITs
**Self-generated:** 0
- [WARNING] an incomplete or trimmed read replaces a complete stored week --> FIXED on the coordinator (the console marks such rows partial) plus a plan residual (bbf75f760d)
- [WARNING] an unreadable agent keeps the daily truncated for up to a week --> DEFERRED: stated residual (conservative and true: that work is unknown)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 4 WARNINGs, 5 NITs
**Self-generated:** 0
- [WARNING] an agent on a provider with no receipt marked every daily truncated, making that member "partial" across the console --> FIXED (ba4328b29e; not counted, by design, as on the task page; mutant)
- [WARNING] an unreadable project list could still send [] --> FIXED (ba4328b29e; not reported; mutant)
- [WARNING] the console shows "never reported" and "none" alike --> DEFERRED: stated residual (needs a stored marker per Kosmos, a separate change)
- [WARNING] closedAtOf was unguarded, so one malformed task dropped the whole field --> FIXED (ba4328b29e; marks the read incomplete; mutant)
- NITs: a comment named a symbol that does not exist, the plan's test count, an off-by-one test message --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs new (both repeat recorded residuals: the read that continues after its timeout is the plan's weakest premise; the unreadable-agent partial is iteration 2's residual), NITs only
**Self-generated:** 0
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/orgrollup.js fit | BRANCH | trim to [] wipes the week | FIXED | 3c2897608 |
| 2 | 1 | WARNING | engine/orgrollup.js projectUsageByDay | BRANCH | concurrent holds count twice | DEFERRED | residual |
| 3 | 1 | WARNING | engine/orgrollup.js projectUsageByDay | BRANCH | no task cap | FIXED | 3c2897608 |
| 4 | 1 | WARNING | engine/orgrollup.js | BRANCH | doc comment on the wrong function | FIXED | 3c2897608 |
| 5 | 2 | WARNING | engine/orgrollup.js | BRANCH | incomplete read replaces the week | FIXED | coordinator partial mark + residual |
| 6 | 2 | WARNING | engine/orgrollup.js | BRANCH | unreadable agent keeps truncated | DEFERRED | residual |
| 7 | 3 | WARNING | engine/orgrollup.js | SELF | provider with no receipt marks every daily truncated | FIXED | ba4328b29e |
| 8 | 3 | WARNING | engine/orgrollup.js | BRANCH | unlistable projects send [] | FIXED | ba4328b29e |
| 9 | 3 | WARNING | console (coordinator) | BRANCH | never-reported vs none | DEFERRED | residual |
| 10 | 3 | WARNING | engine/orgrollup.js | BRANCH | closedAtOf unguarded | FIXED | ba4328b29e |

### NITs (non-blocking, across all iterations)
- The abandoned read continues after its timeout (bounded; plan weakest premise). The tick test's reader ignores its argument. No test pins the window's boundary day. Cost is recomputed after rows that clean to one key are summed.

### Strengths (across all iterations)
- "Not reported" and "none" are kept apart end to end, including a size trim that empties the rows.
- Consent is the same two-part rule on the board and the coordinator; the read runs on the daily send only and only in the enrolled Kosmos.
- The board and the coordinator agree on field names, the 200-row cap, the day rule and listed-projects-only; the trim order keeps the coordinator's checks satisfiable.
