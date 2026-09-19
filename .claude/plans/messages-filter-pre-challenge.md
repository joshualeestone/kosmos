---
pre_challenge: true
method: challenge-loop
branch: messages-filter
diff_hash: 5b1cabda22a7ae138684d2eacf480836c8f3111ad1fb8cf085769302a0c98003
validation: passed
subdir_audit: passed
timestamp: 2026-09-19T16:29:55Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 5 (3 BLOCKERs, 1 WARNING, 1 NIT)
**Fixed:** 4 | **Deferred:** 1 | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 3 BLOCKERs, 1 WARNING
- [BLOCKER] web/index.html card() not-running branches (needstrust ~15200, off notrunning ~15215) omitted data-has-msgs, so an OFFLINE agent with unread messages was HIDDEN by the filter --> FIXED (6de092f07: added hasMsgsAttr to both roots)
- [BLOCKER] web/index.html lrow() not-running branches (~15417, ~15430), same bug --> FIXED (6de092f07)
- [BLOCKER] web/index.html .board-msgfilter-exit text was --gold-deep (~3:1, fails WCAG AA) --> FIXED (6de092f07: text --k-ink, gold moved to the underline accent)
- [WARNING] docs/browser-checks/render-dm-badges-2863.js asserted only the org DIM, never grid/list HIDE, and no offline fixture --> FIXED (54c798a46: list-hide + offline-agent-shown guard, restores org view + running fleet after)

#### Iteration 2
**Reviewer model:** opus (different model from iteration 1, per kosmos#2032)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Converged** -- opus verified both prior fixes applied (all 6 card()/lrow() returns emit hasMsgsAttr; exit-link text is --k-ink, AA on every theme), confirmed the filter can never hide every row (tile hidden + auto-exit at dmTotal<=0; exit link is a toolbar sibling shown by body.filter-msgs), the persistence is desync-free, the keyboard path is complete (Enter/Space + preventDefault), and the browser-check is non-vacuous and restores state.
- [NIT] web/index.html:1596 -- in consolidated view the filter would also hide no-message rail rows --> DEFERRED: consistent/expected behavior (the filter applies to the consolidated rail too); not a defect, worth a glance only if consolidated filtering becomes a real user path.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web/index.html card() early returns | BRANCH | offline agent with msgs hidden | FIXED | 6de092f07 |
| 2 | 1 | BLOCKER | web/index.html lrow() early returns | BRANCH | offline agent with msgs hidden | FIXED | 6de092f07 |
| 3 | 1 | BLOCKER | web/index.html .board-msgfilter-exit | BRANCH | exit-link text fails AA contrast | FIXED | 6de092f07 |
| 4 | 1 | WARNING | render-dm-badges-2863.js | BRANCH | filter guard under-covered (org only) | FIXED | 54c798a46 |
| 5 | 2 | NIT | web/index.html:1596 | BRANCH | filter applies to consolidated rail | DEFERRED | expected behavior |

### Strengths
- dmTotal (excludes CURRENT) vs agentHasMsgs (ignores CURRENT-suppression) split is deliberate: an open messaged agent stays visible; when it is the last, dmTotal->0 auto-exits the filter -- no stuck empty board (iter 2).
- Org DIM vs grid/list HIDE is a pure body class + data-has-msgs CSS, never touching BOARD_LAYOUT, so grid/list/org selection is preserved and the change is reversible (iter 2).
