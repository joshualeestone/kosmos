---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0822
diff_hash: 82eb6c608d0c7cf520932aa2f67c4390bf49ac2ba53e14b47e19c34a552de313
validation: passed (Mortals)
subdir_audit: passed
timestamp: 2026-11-25T04:43:06Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 6 (1 BLOCKER, 4 WARNINGs, 0 CONVENTIONs, 8 NITs)
**Fixed:** 6 | **Deferred:** 0 | **Asked (awaiting user):** 0

Validation: full suite on Mortals via mortals-validate.sh, entry `"status":"clean"`, hash 82eb6c608d0c (equal to this
proof's diff_hash), 31,042 tests, 0 failed, at head d7bcc7437e, 22:14 to 22:42 CST. This Mac's queue had it 19th. The
subdir CLAUDE.md audit passed (no subdir CLAUDE.md in the diff). The 8 test files that read the What's New files
passed after every iteration (527 pass, 0 fail).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [BLOCKER] release/whats-new-pool.json - "Built but waiting" said "all" open tasks built; the pill shows on ANY (builtWaiting > 0) --> FIXED (9aac451c02)
- [WARNING] release/whats-new-pool.json - the stall-refusal note was untagged, so it would tell Windows agents about a guard only the Mac and Linux hook has --> FIXED: tagged mac, Linux loses the note, documented (9aac451c02)
- [NIT] the stall note overstated what it covers --> FIXED (names the two shapes)
- [NIT] plan: say what a touch user meets --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the Built line fixed in iteration 1)
- [WARNING] release/whats-new-pool.json - "Built but waiting" is the last pill in the order, so a paused project or one with a question keeps its own pill --> FIXED: "an active project with nothing running" (81586ced61)
- [NIT] plan overclaimed #8990 as invisible --> FIXED (real, not worth a line)
- [NIT] "point at" has no touch equivalent (already in the plan)
- [NIT] the stall note's Linux loss (already in the plan)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] .claude/plans/whatsnew-0822.md - #8952 slice d (PR #9003) was left out as iPhone-only, but it changes the engine and the board gets Allow on a long permission request --> FIXED: added as the first highlight, tagged mac (d7bcc7437e)
- [NIT] the Built line should name Projects --> FIXED (d7bcc7437e)
- [NIT] the stall note could say when Claude Code's prompt would reach the person

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.
- [NIT] the stall note reads as unconditional (a duplicate of iteration 3's NIT)
- [NIT] a card to let the pool tag Linux

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | release/whats-new-pool.json | BRANCH | Built line said "all" | FIXED | 9aac451c02 |
| 2 | 1 | WARNING | release/whats-new-pool.json | BRANCH | stall note untagged, false on Windows | FIXED | 9aac451c02 |
| 3 | 2 | WARNING | release/whats-new-pool.json | SELF | Built line wrong for paused projects | FIXED | 81586ced61 |
| 4 | 3 | WARNING | .claude/plans/whatsnew-0822.md | BRANCH | #9003 wrongly left out as iPhone-only | FIXED | d7bcc7437e |

### NITs (non-blocking, across all iterations)
- the stall note could say when Claude Code's prompt would reach the person (iterations 3, 4)
- a card to let the pool tag Linux (iteration 4)
- "point at" has no touch equivalent, stated in the plan (iteration 2)

### Strengths (across all iterations)
- Pool bookkeeping is right: 0.8.21's three highlights are marked shown in 0.8.21, lastProd and lastProdWin are 0.8.21 (iterations 1 to 4)
- Every line checked against its PR and the code on main; the "point at" wording matches #9008's hover-only text (iterations 1 to 4)
- Every merge since the v0821 bump is accounted for in the plan, with a reason for each one left out (iterations 1, 3, 4)
