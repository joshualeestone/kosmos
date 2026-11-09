---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0801
diff_hash: 6a870e30ddfe60c5b56d76d38ea7f31f9f4682bd08da467ce902bcd5048d9eab
validation: passed (Mortals)
subdir_audit: passed
timestamp: 2026-11-09T20:55:10Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 1 BLOCKER, 8 WARNINGs, 2 CONVENTIONs, 7 NITs
**Fixed:** 11 | **Deferred:** 1 | **Asked (awaiting user):** 0

**Validation, stated exactly.** The full suite ran once, at convergence, on Mortals: entry status clean, hash 6a870e30ddfe, 28292 tests, 0 fail, 0 cancelled. The change is data only. Each iteration that changed the data ran tools/whats-new-pool.js build and tools/whats-new-check.js for both platforms. The 6j helper skipped on the clean entry, rc 0.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 5 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0 of the above (no loop commit existed yet)
- [BLOCKER] release/whats-new-pool.json:1425 - the one-step line is false on Windows and overclaims beyond Claude agents --> FIXED (mac tag, "A Claude agent's")
- [WARNING] release/whats-new-pool.json:664 - "Old project summaries say why" is a CLI-only change in the window --> FIXED (notesOnly)
- [WARNING] release/whats-new-pool.json:1471 - #8270 and #8271 dated 0.8.01 though they shipped in 0.8.00 --> DEFERRED: the default kosmos whats-new shows only the newest version's notes, as 0.8.00 did for two 0.7.99 items; cost in the plan
- [WARNING] .claude/plans/whatsnew-0801.md:13 - the table's heading was false for those two --> FIXED
- [WARNING] .claude/plans/whatsnew-0801.md:18 - the Team map removal had no line --> FIXED (notesOnly 87)
- [CONVENTION] .claude/plans/whatsnew-0801.md:23 - #8324 and #8326 left out for the wrong reason --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] web/whats-new.json:19 - old 0.7.36 and 0.7.96 items held window slots --> FIXED (today's items rank above them)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] release/whats-new-pool.json:1445 - the restart note was never run on Windows --> FIXED (mac tag)
- [WARNING] .claude/plans/whatsnew-0801.md:23 - #8324 adds a new rule and output --> FIXED (notesOnly 88)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | release/whats-new-pool.json:1425 | BRANCH | One-step line false on Windows | FIXED | mac tag |
| 2 | 1 | WARNING | release/whats-new-pool.json:1471 | BRANCH | since one version late | DEFERRED | Default view shows newest only |
| 3 | 3 | WARNING | release/whats-new-pool.json:1445 | SELF | Restart note unrun on Windows | FIXED | mac tag |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] .claude/plans/whatsnew-0801.md - Linux behaviour of the tag is not checked by any tool (iteration 4)
- [NIT] release/whats-new-pool.json - two similar spacing titles if both ever reach the window (iteration 2)

### Strengths (across all iterations)
- The built file is byte-identical to the tool's output and both platform checks pass (iterations 1 to 4)
- The plan accounts for every merged PR with a reason for each (iterations 3 and 4)
