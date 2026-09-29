---
pre_challenge: true
method: challenge-loop
branch: rename-followups-4423
diff_hash: 9fc024d30a38ea92edd30f23c7af46a4445cfde732d96abc7c2ce96a084f6ada
validation: passed
subdir_audit: passed
timestamp: 2026-09-29T07:25:40Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes, at iteration 4
**Total findings:** 2 BLOCKERs, 10 WARNINGs, 1 CONVENTION, 13 NITs
**Resolved:** every BLOCKER, WARNING and CONVENTION fixed; NITs fixed or noted (ledger in
.claude/plans/rename-followups-4423-20260928T2331Z.md). **Asked (awaiting user):** 0 in this loop; the community
identity (card item 7) is a decision for Renet and Josh, not built.

Validation: `yarn test` via validation-log, gated on heavy-gate --twice --quiet-box, PASSED at 31d869096 (rebased
onto main after #4437 merged): 11670 tests, 11505 pass, 0 fail, 165 skipped. The 34 affected test files, each alone,
0 fail on the new base. Subdir CLAUDE.md audit: passed. Browser check render-rename-followups-4423.js with controls
(the #4437 page fails RENAMED and ROLE; innerHTML comparison fails STEADY; no reset on open fails REOPEN; no Save
marking fails SAVED).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [BLOCKER] followCard broke web.pill-remembered-3958's adjacency pin --> FIXED (after refreshStartAffordance)
- [WARNING] room reply strip not repainted on the room poll --> FIXED
- [WARNING] Reports-to menu rebuilt every poll (read-back markup) --> FIXED (dataset.html)
- [WARNING] menu could stop following for good --> FIXED (dataset.shown)
- [WARNING] server wiring for note facts untested --> FIXED (source pin)
- [WARNING] readIdentity per note per read --> FIXED (per-read cache)
- [CONVENTION] noteTextNow above the wrong doc comment --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] Save marked the menu with the post-await value --> FIXED (reportsSent)
- [WARNING] no real-browser check of this card's own behaviour --> FIXED (render-rename-followups-4423.js)

#### Iteration 3
**Reviewer model:** opus
- [BLOCKER] reopening an agent kept an abandoned Reports-to pick --> FIXED (openDetail forgets dataset.html; REOPEN arm)
- [WARNING] DM strip borrowed the previous agent's name after a switch --> FIXED
- [WARNING] Save's marking untested --> FIXED (SAVED arm)
- [WARNING] unit fixture blind to the open path --> FIXED (REOPEN in the browser)

#### Iteration 4
**Reviewer model:** sonnet
- [NIT] web.reply-where's 3400-char window at 3379 (pre-existing, not moved) --> NOTED
**Converged:** no BLOCKER, WARNING or CONVENTION findings.

### Final Ledger

| # | Iter | Category | Description | Status | Resolution |
|---|------|----------|-------------|--------|------------|
| 1 | 1 | BLOCKER | pill adjacency pin broken | FIXED | 18e6be27a |
| 2 | 3 | BLOCKER | reopen kept an abandoned pick | FIXED | c0a7ad174 |
| 3 | 1 | WARNING | menu rebuilt every poll | FIXED | 18e6be27a |
| 4 | 2 | WARNING | Save marked a later value | FIXED | 36179a0cd |

### Strengths
- Every surface is named from the current card at render time; a real-browser check with a control per fix
