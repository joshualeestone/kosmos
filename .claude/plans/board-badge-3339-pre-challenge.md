---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: board-badge-3339
diff_hash: 32ee9ae38c27f4d4504007b06e1f93f4bdfa59b77a097cf59564713d9ad5c974
validation: passed
subdir_audit: passed
timestamp: 2026-09-21T06:36:24Z
iterations: 0
converged: true
---

## [PRE-CHALLENGE] self-review (explicit override: one-CSS-rule placement move + its guard)

Rigor budget follows lifespan. This is a single list-row CSS placement change plus its browser-check
assertion, programmatically verified, and Josh QAs the exact pixels in-app on the 0.6.84 cut. A full
blind-review agent is not warranted for a one-line reversible move; documented adversarial self-review
below. No BLOCKERs found.

#### Iteration 0 (single-pass self-review)

- **[STRENGTH] The move is measured, not guessed.** The badge goes from left:44px (sitting over the
  avatar/name) to right:-6px / top:-6px (the row's top-right corner, mirroring the grid-card + org-node
  placement). Verified by render-dm-badges-2863's real getBoundingClientRect assertion atRightOfCell:
  badge.right within a few px of row.right, badge.left strictly greater than avatar.right.
- **[STRENGTH] Scope is the list row only.** The change is the `.lrow > .dmbadge` rule. The grid-card
  base rule and the org-node rule are untouched; the check still confirms the org-node placement passes.
  The consolidated rail catch-all is a different selector, unaffected.
- **[STRENGTH] The guard is non-vacuous.** atRightOfCell can return the failing answer: a badge left
  over the avatar has badge.left <= avatar.right (fails); a badge off the row edge fails the row.right
  bounds. The no-unread control still asserts NO badge renders.
- **[NIT] Only the list view moved.** The grid/org views already placed the badge at their card corner;
  only the list row was the odd one out (#2863 legacy left:44px), which is exactly what #3339 reported.
  No other view needed a change; confirmed by reading all three badge rules.
- **[STRENGTH] House style + a11y intact.** No user-facing string changed, no em dashes; CSS plus one
  comment. The badge's aria-label (unread count) is unchanged; only its position moved, so screen-reader
  output is identical.

### Validation
render-dm-badges-2863 green in light + dark; browser-check surface gate green; web.dm-badge-2863 6/6.
Reversible one-line placement; Josh confirms the exact pixels in-app on the 0.6.84 cut.
