---
pre_challenge: true
method: challenge-loop
branch: cluster-reorder-2929
diff_hash: 7fba33b85a45bea5a707d274a6048e40c899c1a0f7e2a8740a85c09940ed2c9b
validation: passed
subdir_audit: passed
timestamp: 2026-09-13T20:57:43Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 (blind reviews, reviewer model alternated opus / sonnet across every pass per kosmos#2032)
**Converged:** Yes (iteration 7, opus, found zero BLOCKER/WARNING/CONVENTION/NIT)
**Total findings:** 0 BLOCKER, 6 WARNINGs, 2 CONVENTIONs, plus NITs (deferred where accepted)
**Fixed:** all BLOCKER/WARNING/CONVENTION | **Deferred:** 2 NITs (documented) | **Asked:** 0

#2929 slice 2: on the consolidated projects view a whole top-level project cluster can be dragged to reorder it (Josh 6.59 QA "drag it up to the very top"). Slice 1 (the openable tree) shipped in #2994. CSS+JS in web/index.html, consolidated-gated, plus a new headless drag browser-check. The loop's value showed clearly: each earlier pass surfaced a real defect of adding drag + a manual-order to a poll-repainted, multi-layout list, until convergence.

### Per-Iteration Breakdown

#### Iteration 1 (opus)
**New:** 1 WARNING, NITs. **Self-generated:** 0.
- [WARNING] #pj-sort went stale after a drag (control lied; re-picking the shown sort was a no-op) --> FIXED (disabled "Custom order" reflection; cea8870f5).

#### Iteration 2 (sonnet)
**New:** 2 WARNINGs. **Self-generated:** 1 (the iter-1 reflection).
- [WARNING] ~5s poll repainted #pj-list mid-drag, detaching the drag node --> FIXED (PJ_DRAGGING guard; f48d35088).
- [WARNING] check only exercised the insert-before branch --> FIXED (lower-half/self-drop/drag-to-last arms).

#### Iteration 3 (opus)
**New:** 1 WARNING. **Self-generated:** 1.
- [WARNING] loadProjects error path repainted #pj-list unguarded -> stranded PJ_DRAGGING -> froze the list --> FIXED (guard that writer + self-heal in paintProjects; 2268b729c).

#### Iteration 4 (sonnet)
**New:** 2 WARNINGs. **Self-generated:** the guard-completeness one.
- [WARNING] two empty-state #pj-list writes unguarded (comment overclaimed "every writer gated") --> FIXED (guarded; 98c116e51).
- [WARNING] drop no-reorder returns skipped the dragend catch-up --> FIXED (defer to dragend).

#### Iteration 5 (opus)
**New:** 1 CONVENTION. **Self-generated:** 0.
- [CONVENTION] "manual order active" predicate derived twice (repo #5) --> FIXED (single pjManualOrderActive() helper + tightened tab-scoping arm; 89dbbb174).

#### Iteration 6 (sonnet)
**New:** 1 WARNING (test), 1 CONVENTION (plan count). **Self-generated:** the vacuous arm.
- [WARNING] "sort clears the manual order" arm was vacuous (ran after PJ_ORDER already null) --> FIXED (activate an order first; 73406ff1f).
- [CONVENTION] plan count stale --> FIXED (42/42).

#### Iteration 7 (opus)
**New findings:** 0. **Self-generated:** 0.
**Converged** — five STRENGTHs; verified writer-gating by grep (all four #pj-list writers gated), test non-vacuousness, no isolation-test break, view-switch draggable reset, no em dashes.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status |
|---|------|----------|------|--------|-------------|--------|
| 1 | 1 | WARNING | web/index.html | BRANCH | sort control stale after drag | FIXED cea8870f5 |
| 2 | 2 | WARNING | web/index.html | BRANCH | mid-drag repaint detaches node | FIXED f48d35088 |
| 3 | 2 | WARNING | render-cluster-reorder-2929.js | BRANCH | check missed insert-after branch | FIXED f48d35088 |
| 4 | 3 | WARNING | web/index.html | SELF | error-path unguarded write -> freeze | FIXED 2268b729c |
| 5 | 4 | WARNING | web/index.html | SELF | empty-state writes unguarded | FIXED 98c116e51 |
| 6 | 4 | WARNING | web/index.html | SELF | drop returns skipped dragend catch-up | FIXED 98c116e51 |
| 7 | 5 | CONVENTION | web/index.html | SELF | predicate derived twice | FIXED 89dbbb174 |
| 8 | 6 | WARNING | render-cluster-reorder-2929.js | SELF | vacuous sort-clears arm | FIXED 73406ff1f |
| 9 | 6 | CONVENTION | plan | SELF | stale assertion count | FIXED 73406ff1f |

### Deferred (deliberate, documented)
- [NIT] pointer-only reorder (no keyboard path): the sort dropdown is the keyboard ordering; matches org-drag precedent. On the plan.
- [NIT] stale PJ_ORDER ids for deleted projects: inert + self-heal on next drag.

### Strengths (across iterations)
- pjManualOrderActive() is a single source of truth for both the control reflection and the reorder (repo #5 satisfied, pinned by the check).
- PJ_DRAGGING gates every #pj-list writer (verified by grep, not just the comment) + a self-heal backstop, so the guard cannot freeze the board.
- The reorder is non-mutating, stable, and never drops/hides a project (stale/new ids handled).
- The browser-check dispatches real HTML5 DragEvents with a shared DataTransfer; every arm is a non-vacuous control; registered in all three places; both themes.
