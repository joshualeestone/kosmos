---
pre_challenge: true
method: challenge-loop
branch: buildver-7281
diff_hash: 0c695d047cd874365a927ff13fe3403da9dd851bdd688d8e0329d4cc7a1f0778
validation: passed
subdir_audit: passed
timestamp: 2026-10-27T09:19:57Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes
**Total findings:** 2 (0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 7 NITs)
**Fixed:** 2 | **Deferred:** 0 | **Asked (awaiting user):** 0

6.0 initial validation passed (full suite, hash e822b9b8300e) and the subdir audit was clean, so the first
reviewer ran as iteration 1 on a clean baseline.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty)
- [WARNING] tools.build-linux-7281.test.js:254 - the CONTROL's new VERSION and stderr assertions can fail only where `bash` on PATH is 3.2, and the comment read as if they guarded the bug alone --> FIXED (c641c077fd): the comment says so and points at the source check
- [NIT] tools.build-linux-7281.test.js:261 - the source regex is per line
- [NIT] tools/build-kosmos-linux.sh:261 - `bash -n` cannot see this defect either

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] tools.build-linux-7281.test.js:263 - the source check is single-line, so a case split across lines inside $( ) passes it --> FIXED (249f1bfe01): the whole file is scanned, `[^)]` keeps a match inside one substitution; probed against main's line, split and newline-after-in shapes (hit) and the safe `(pattern)` forms and a top-level case (no hit)
- [NIT] tools.build-linux-7281.test.js:263 - newline after `in`; backticks not covered (the first is now covered)
- [NIT] tools.build-linux-7281.test.js:258 - VER comes from the Mac builder's default (an existing test keeps the three builders equal)
- the reviewer's [CONVENTION] line only noted that the plan exists and matches; not a defect

#### Iteration 3
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tools.build-linux-7281.test.js:254 | BRANCH | CONTROL assertions red only under bash 3.2; comment overstated | FIXED | c641c077fd |
| 2 | 2 | WARNING | tools.build-linux-7281.test.js:263 | BRANCH | source check single-line only | FIXED | 249f1bfe01 |

Proof for the final head: tools.build-linux-7281.test.js 10/10; with main's builder restored, the CONTROL and the source
check both fail (8/2). Full suite green at 6g (hash 0c695d047cd8), 6j skipped on that clean entry.

### NITs (non-blocking, across all iterations)
- [NIT] tools.build-linux-7281.test.js - the source guard is per line (iteration 1; resolved by iteration 2's fix)
- [NIT] tools/build-kosmos-linux.sh:261 - `bash -n` passes on both old and new files, so a parse lint would not catch this (iteration 1)
- [NIT] tools.build-linux-7281.test.js - backtick substitution not covered (iteration 2)
- [NIT] tools.build-linux-7281.test.js - VER coupling to the Mac builder's node default (iteration 2)
- [NIT] tools.build-linux-7281.test.js:265 - a `)` inside the case subject, or a case that is not the substitution's first command, passes the guard; none exist in any tracked .sh today (iteration 3)
- [NIT] tools.build-linux-7281.test.js:253 - the exact-match node line also catches any format drift on any bash, broader than the comment says (iteration 3)
- [NIT] .claude/plans/buildver-7281.md:5 - "line 261" is main's line number (iteration 3)

### Strengths (across all iterations)
- The defect reproduced independently under /bin/bash 3.2.57 by two reviewers; the fix keeps bash 5 output identical (iterations 1, 3)
- `_node_note` is initialised before use, so `set -u` cannot trip; a non-matching case returns 0 (iterations 2, 3)
- The VERSION assertion is an exact string, so leftover syntax-error text cannot slip through (iterations 1, 3)
