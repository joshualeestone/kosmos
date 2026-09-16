---
pre_challenge: true
method: challenge-loop
branch: task-sort-newest-3172
diff_hash: f0341c0b0d9f0c1c0a2ceb9e37dfcd7780f88a759d450ca216350e3e2698384e
validation: passed
subdir_audit: passed
timestamp: 2026-09-16T14:11:22Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 2 (0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT)
**Fixed:** 1 | **Deferred:** 1 | **Asked (awaiting user):** 0

Reviewer models rotated (opus, sonnet), so convergence is witnessed by two models.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 (findings cite pre-existing lines / the plan, not loop-fix commits)
- [WARNING] web/index.html:38108 / engine/tasks.js:646 — the View-All index screen still orders open tasks oldest-first WITHIN the open group, reproducing #3172's complaint on that screen; the plan's justification for scoping it out was imprecise (it is not "already newest-first"). --> FIXED (5099217f9): corrected the plan to state the accurate scope reason (Josh's #3172 wording is the project column) and documented the View-All residual as a deliberate, reversible scope call flagged to Josh. #3172 stays scoped to paintProjectTasks; no code change.
- [NIT] web/index.html:38005 — the comparator `Number(b.number) - Number(a.number)` yields NaN on a null/undefined number. --> DEFERRED: the number is server-issued and monotonic, and the card render at the same site already depends on it (a missing number already breaks the card), so the invariant holds; a `||0` fallback would mask a real bug rather than fix one.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0
**Converged** — no new actionable findings. The reviewer independently confirmed the sort-before-slice placement, the bidirectional cap test, the no-mutation property, and the content-based task-page click.

### Final Ledger
| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html:38108 / engine/tasks.js:646 | BRANCH | View-All index still oldest-first within the open group; plan justification imprecise | FIXED | 5099217f9 (plan corrected + scope documented) |
| 2 | 1 | NIT | web/index.html:38005 | BRANCH | comparator NaN on a null number | DEFERRED | number is a server-issued monotonic invariant the card render already relies on |

### Outstanding questions (ASKED, still unresolved)
None.

### Deferred items (for operator override)
- [NIT] the sort comparator assumes `t.number` is finite. Safe: the number is server-issued and monotonic, and the card render at the same site already depends on it, so a missing number is already a broken card; a `||0` fallback would mask that rather than fix it.
- SCOPE (documented, flagged to Josh): the All-tasks index (View All) still shows open tasks oldest-first within the open group. #3172's wording is the project column ("on project pages, tab or consolidated view"), so this is out of scope; whether View All should match the newest-first direction is a Josh call, and a one-line within-group tiebreak in `allTasks()` if yes (#3171's browser-check pins open-above-closed, not within-group order, so it still holds).

### Strengths (across all iterations)
- The sort is placed BEFORE the `TK_COLUMN_MAX` slice, which is the crux: a sort after the slice reorders only the five already-shown and still hides the newest behind the five oldest, which IS the bug.
- The new 6-task cap browser-check is a genuine bidirectional guard (asserts the newest is on top AND the oldest is absent), so it fails if the sort ran after the slice; negative-control verified (disabling the sort fails the check).
- `column` is a fresh `.filter()` array, so the in-place sort does not mutate `p.tasks` or any other consumer's order; no order-dependent consumer exists (the door keys off count/emptiness, click handlers off `data-task`).
- The browser-check's task-page click was decoupled from column order (targets the assigned card by its `.tksay` says-line); the who-chip assertions were re-mapped consistently for newest-first.
- Tab and consolidated views share one render (`paintProjectTasks` -> `#pj-tasklist`; consolidated is CSS layout only), so one sort covers both. Confirmed independently with Angel, whose consolidated part is a verified no-op.
