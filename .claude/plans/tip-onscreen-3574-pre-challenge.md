---
pre_challenge: true
method: challenge-loop
branch: tip-onscreen-3574
diff_hash: 755c79efdf3d611761cbe967f5638bcf2071a23f45df3e402845dc406a5fc51f
validation: passed
subdir_audit: passed
timestamp: 2026-09-25T07:54:59Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iteration 6 had nothing at WARNING or above; its one NIT was taken)

#### Iteration 1 (opus)
- [WARNING] Phone width: a rounded offsetWidth against a fractional pageW could refuse every place. Fixed: 1px horizontal slack, and the grid search runs at phone width.
- [WARNING] T32 never ran the reported phone case. Fixed: T32b runs the real card at 390px.
- [NIT] Assertions on all four edges with the pad; sideways off screen counts too. Taken.
- [NIT] A card taller than the window. Taken in iteration 3.

#### Iteration 2 (sonnet)
- [WARNING] Nothing tested a target off screen sideways. Fixed: T32 left and right arms. Control: without the sideways terms, both fail.
- [NIT] T32b did not assert "no arrow". Taken.

#### Iteration 3 (opus)
- [WARNING] A card taller than the window ran off the bottom (already on main). Fixed: the words scroll inside the card (.tip-bd), and the no-target 80px floor is clamped. T32c covers it. Controls: without the scroll rule it fails, and without the clamp it fails.
- [NIT] The stay-put check used exact edges. Fixed: it uses the same onScreen test.
- [NIT] T32b's low arm was relabelled as a control, and the plan was updated.

#### Iteration 4 (sonnet)
- [BLOCKER] A 100vh budget overstates a phone with its toolbar showing (the iOS shell). Fixed: tipPlace measures the height from the real window.
- [WARNING] The scrolling words had no keyboard path. Fixed: a labelled region with tabindex 0, only while they scroll.
- [WARNING] The 150px budget was a guess. Removed by the measurement; T32d covers narrow and short.
- [NIT] The vertical test margin was tightened to 12.

#### Iteration 5 (opus)
- [WARNING] On WebKit, scrolled words re-placed the card every frame (measured by the reviewer: 72 times a second). Fixed: tipRelayout ignores scrolls inside #tiplayer, and the height is computed without clearing and written only on change. T32f covers it; control: without the ignore, it fails.
- [WARNING] A focused word region lost focus when the window grew. Fixed: focus moves to Got it first. T32g covers it; control: without the hand-off, it fails.
- NITs taken: the focus ring on .tip-bd, a 24px floor, and T32f renamed.

#### Iteration 6 (sonnet)
No BLOCKER or WARNING.
- [NIT] The wrapper's first-child margin added 4px under a list-led title. Fixed; the gap is measured at 4px, equal to main.

## Validation
Full suite clean: 9,079 tests, 0 failed (hash 755c79efdf3d611761cbe967f5638bcf2071a23f45df3e402845dc406a5fc51f). render-help-tips-3574 passes, and every T32 arm also passed once under Playwright WebKit.
