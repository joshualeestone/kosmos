---
pre_challenge: true
method: challenge-loop
branch: shared-rxn-picker-2834
diff_hash: ca74924f485130fd63d6001e9a75be52cf88055ccf0f474914cb7a1e1518fd5a
validation: passed
subdir_audit: passed
timestamp: 2026-09-11T23:48:55Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes (iteration 5 found zero actionable findings)
**Total findings:** 7 actionable (0 BLOCKERs, 6 WARNINGs, 1 CONVENTION-NIT) + 2 NITs, plus one synthetic validation finding
**Fixed:** 9 | **Deferred:** 0 | **Asked:** 0

An intricate refactor (a hardened room-reaction interaction moved from a per-post
inline picker to one shared `#rxn-picker`), so every iteration through 4 found a
real issue; iteration 5 (opus) converged clean. Convergence witnessed by two
models: sonnet raised the last real issue (iter 4), opus confirmed clean (iter 5).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 0 NITs (+ 1 synthetic validation BLOCKER)
**Self-generated:** 0 (no loop fix commits yet; validation finding is BRANCH by rule)
- [WARNING] web/index.html outside-click comment — stale ("handled by the room handler which repaints and closes"); post-refactor the shared picker's own handler reacts + closes explicitly --> FIXED (3112640c)
- [WARNING] web/index.html paintThreadInto — the shared picker is not closed when a room rebuild re-renders the open post's row (aria desync) --> FIXED (3112640c)
- [BLOCKER] initial-validation: web.room-scroll.test.js threw ReferenceError (my repaint-close fix added a bare document.getElementById to a headless-tested paint fn) --> FIXED with a typeof document guard (47cf800f). Caught by the full validation suite, not the blind reviewers.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 (findings were against original + iter-1 code; none on lines a loop fix authored)
- [WARNING] render-reactions-2255.js — the repaint-close path had zero test coverage --> FIXED, added a repaint-close arm (f738307e)
- [WARNING] render-reactions-2255.js — cross-post routing unverified (every arm drove one post; an always-route-to-fixed-post bug would pass) --> FIXED, added a cross-post arm (f738307e)
- [NIT] web/index.html — the `box.__lastLive !== html` gate was redundant (paintRoom's `__lastRoom` gate already ensures paintThreadInto only runs on a content change) and its comment misleading --> FIXED, removed the redundant gate + corrected the comment (f738307e)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0
- [WARNING] render-reactions-2255.js — the repaint-close arm posted a NEW message, which pins to bottom + fires a scroll that the scroll-dismiss path acts on, so the arm would pass even if the close block were deleted (not isolated) --> FIXED, changed it to react to an existing post (same row set, no scroll) so only the close block can hide the picker (49650885)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
- [WARNING] web/index.html — the shared `#rxn-picker` (at body) can be orphaned across navigation (project switch, project-gone pjView('list')), a class the old inline picker structurally could not have; pjView already resets a sibling member picker but was not extended --> FIXED, close the reaction picker on any navigation in pjView (5445801)
- [NIT] render-reactions-2255.js — the repaint-close arm reacted to the first post and never toggled it off (breaks the file's leave-it-clean convention) --> FIXED (5445801)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 actionable
**Self-generated:** 0
**Converged** — traced every path (room poll never routes through pjView; paintOneProject only navigates on project-gone; headless guard verified against web.room-scroll.test.js; no stale inline picker refs; composer parity; XSS-safe textContent). Only strengths.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html (outside-click) | BRANCH | Stale dismiss comment | FIXED | 3112640c |
| 2 | 1 | WARNING | web/index.html paintThreadInto | BRANCH | Picker not closed on room rebuild | FIXED | 3112640c |
| 3 | 1 | BLOCKER | web.room-scroll.test.js | BRANCH | bare document ref broke headless test | FIXED | 47cf800f |
| 4 | 2 | WARNING | render-reactions-2255.js | BRANCH | repaint-close uncovered | FIXED | f738307e |
| 5 | 2 | WARNING | render-reactions-2255.js | BRANCH | cross-post routing unverified | FIXED | f738307e |
| 6 | 2 | NIT | web/index.html paintThreadInto | SELF | redundant __lastLive gate + comment | FIXED | f738307e |
| 7 | 3 | WARNING | render-reactions-2255.js | SELF | repaint arm not isolated from scroll-dismiss | FIXED | 49650885 |
| 8 | 4 | WARNING | web/index.html pjView | BRANCH | picker orphaned across navigation | FIXED | 5445801 |
| 9 | 4 | NIT | render-reactions-2255.js | SELF | repaint arm leaves a stray reaction | FIXED | 5445801 |

### Outstanding questions (ASKED)
None.

### NITs / Strengths (across all iterations)
- Strength: rxnToggle is the single shared react path (no two-copies drift), preserved across all reviews.
- Strength: cross-post routing arm is non-vacuous (firstGot 1 / lastStayed 0); repaint-close arm isolated via same-row-set change.
- Strength: typeof document headless guard verified necessary against web.room-scroll.test.js.
- Strength: pjView close-on-navigation fires only on navigation, never on in-view polls; rxnCloseAllPickers null-safe.
- Note: the browser interaction (routing, positioning, dismiss, repaint-close) is verified end-to-end by the browser-checks CI workflow (browser-checks.yml), which runs render-reactions-2255.js headless on this PR (it triggers on web/index.html + docs/browser-checks/**).
