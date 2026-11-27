---
pre_challenge: true
method: challenge-loop
branch: builtfor-9177
diff_hash: 97226e492006a5f3c513a71c03e4698598efe4929c29df79365cdce88e697979
validation: passed
subdir_audit: passed
timestamp: 2026-11-27T03:51:47Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Validation:** passed on Mortals at 73409559e5, entry status clean, hash 97226e492006 (31,611 node tests, 0 failed; all four shell shards green)
**Reviewer models:** opus (1, 3), sonnet (2, 4)
**Total findings:** 0 BLOCKERs, 10 WARNINGs, 0 CONVENTIONs (plus NITs)
**Fixed:** 8 | **Deferred:** 2 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 (no loop commit existed yet)
- [WARNING] engine/tasklist.js:155 - a row kept open for the reader still printed "waits on a review and close" --> FIXED (f8cf2251ff, builtForCaller flag on mine answers, words changed)
- [WARNING] engine/tasks.js:2819 - a reader whose own part is closed saw a task another holder marked come back as open, unlike hasOpenWork --> FIXED (f8cf2251ff, no open part of its own reads built)
- [WARNING] server.tasks-mine-built-9177.test.js - --stale, a closed part and the CLI words untested --> FIXED (f8cf2251ff)
- [NIT] heldByCaller vs exact names for key-identified callers --> named in the plan's weakest premise
- [NIT] whoIsLeft is a related reading --> named in the plan

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs
**Self-generated:** 1 of the above (server.js mineMark, a code line from f8cf2251ff, fixed normally)
- [WARNING] server.js:24451 - builtForCaller also set on held and closed rows, including the caller's own mark --> FIXED (7a7fa80638, builtForReader, one named rule for the group and the flag)
- [WARNING] engine/tasks.js:2832 - builtFor did not say the list adds cases on top --> FIXED (7a7fa80638, comment)
- [WARNING] server.tasks-mine-built-9177.test.js:62 - no route test of an old mark or held rows --> FIXED (7a7fa80638)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs
**Self-generated:** 1 of the above (engine/tasklist.js:156, a code line from f8cf2251ff, fixed normally)
- [WARNING] engine/tasklist.js:156 - a paused project's row never said its project is paused --> FIXED (73409559e5)
- [WARNING] server.tasks-mine-built-9177.test.js:62 - no paused-project route test --> FIXED (73409559e5)
- [WARNING] engine/tasks.js:2828 - an old mark (no builtWho) read built on the list but freed nobody for the Assigner, so an agent could be nudged about a task its list hid --> FIXED (73409559e5): the exception was dropped after measuring this Mac's board (3 marked tasks, none without builtWho); the list and the Assigner now read one rule

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs
- [WARNING] server.js:24680 - the list matches builtWho with heldByCaller, the Assigner with exact names --> DEFERRED: heldByCaller is what decides which parts are the caller's, so matching marks more strictly than parts would make the list disagree with itself; the gap exists only for key-identified tokens and can only hide a task, never show another agent's; stated in the plan's weakest premise
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/tasklist.js:155 | BRANCH | open row worded as waiting on a review | FIXED | f8cf2251ff |
| 2 | 1 | WARNING | engine/tasks.js:2819 | BRANCH | closed own part read as open | FIXED | f8cf2251ff |
| 3 | 1 | WARNING | server.tasks-mine-built-9177.test.js | BRANCH | stale, closed part, words untested | FIXED | f8cf2251ff |
| 4 | 2 | WARNING | server.js:24451 | SELF | flag set on held and closed rows | FIXED | 7a7fa80638 |
| 5 | 2 | WARNING | engine/tasks.js:2832 | BRANCH | builtFor comment silent on the list's cases | FIXED | 7a7fa80638 |
| 6 | 2 | WARNING | server.tasks-mine-built-9177.test.js:62 | BRANCH | old mark and held rows untested | FIXED | 7a7fa80638 |
| 7 | 3 | WARNING | engine/tasklist.js:156 | SELF | paused project not said | FIXED | 73409559e5 |
| 8 | 3 | WARNING | server.tasks-mine-built-9177.test.js:62 | BRANCH | paused route untested | FIXED | 73409559e5 |
| 9 | 3 | WARNING | engine/tasks.js:2828 | BRANCH | old-mark split from the Assigner | FIXED | 73409559e5 |
| 10 | 4 | WARNING | server.js:24680 | BRANCH | heldByCaller vs exact name | DEFERRED | consistency with parts; hide-only gap |

### NITs (non-blocking, across all iterations)
- [NIT] holdsOpenPart calls progressOf again on a per-row path (iteration 2)
- [NIT] the /api/tasks/mine filter computes the group twice (iteration 3)
- [NIT] mineMark checks closure twice (iteration 3)
- [NIT] an older CLI on a newer board groups right but words the row "waits on a review"; in the plan (iterations 3, 4)

### Strengths (across all iterations)
- Three inline copies of the Assigner's predicate are now one exported builtFor with the same meaning
- Without a reader, listGroup and inListOrder behave exactly as before, so the board's views are unchanged
- The new reader only regroups tasks the caller already holds, so no other agent's tasks can be exposed
- Tests show the mirror image for both holders and a CONTROL without mine=1
