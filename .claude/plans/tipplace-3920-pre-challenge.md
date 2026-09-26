---
pre_challenge: true
method: challenge-loop
branch: tipplace-3920
diff_hash: 78b59af53ff9bc8be033bf53b38f6ae5deb68f6953e592ade64ce24fbed6766a
subdir_audit: passed
timestamp: 2026-09-26T09:19:16Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2: a fix measured on the layout it is for (Renet's #3922 branch), then a regression arm, whose own first version was caught by the repo's #758 guard.
**Converged:** Yes.

## Iteration 1
- [STRENGTH] Decided option 1 of the card's three. When no place fits at full width and the wider side has at least 220px, tipPlace places once more, narrowed to that room and side-first, so the card keeps its arrow and stays off its target.
  - Rejected option 2 (point at the column's header row): the card then sits inside the ringed area, which T35 forbids.
  - Rejected option 3 (inside the area): it covers the target's own controls, which tipCoveredControls exempts, reintroducing the 0.6.93 hazard.
- [STRENGTH] Measured on Renet's header-stable-2624 (#3922, the taller header that creates the case), in a scratch worktree:
  - #3922 alone: the Conversation card is `up` and overArea is TRUE, the card's own 3.5% finding;
  - #3922 plus this fix: the card is `left` and overArea is FALSE;
  - the other three steps are unchanged.
- [WARNING] I first "strengthened" T35 to refuse a card on any control. That contradicted the tour's deliberate design: tour steps place with avoid:false because the page is dimmed and a click outside ends the tour. It also turned the Members step red. I reverted it the same hour.
- [STRENGTH] The narrowing is inert where there is room. It is tried only when no place fits at full width, and never repeated (the narrowed call passes a width). Every other call resets the card to the stylesheet width. On current main the Conversation step still has room above, so nothing there changes.

## Iteration 2
- [STRENGTH] T35b drives the real tipPlace on the open card at synthetic window-filling targets:
  - with 244px of side room, the card goes `left`, is narrowed to 244px, and is off the target;
  - control, with 174px of side room: the full 300px width, so the narrowing does not fire.
  With the fix disabled, the first arm goes RED (`up`, 300px, over the target) and the control stays green. The fix was restored with reset --hard to the saved sha.
- [WARNING] The full suite (9888 tests) caught my own T35b: its synthetic target used an id, and #758's guard rightly refuses a check that asks for an id the page does not have. Fixed with a data attribute; the guard passes 4/4.
- [CONVENTION] After merging 37 commits from main, render-help-tips-3574 still passes in full (T35 and both T35b arms). No em dashes were added.

## Coordination
- Renet (#3922) asked for T35 to be made strict in whichever PR lands second. Main's T35 is already strict (`|| g.overArea`). If this lands first, #3922 drops its 5% allowance, which this fix makes unnecessary: that was measured on her branch. She is told.

## Weakest premise
- 220px as the narrowest readable card. It is a judgement: the card's words wrap to more lines at that width. Measured only at the one real case (244px), where the whole card stays on screen.
