# relandnotice-5018: re-land #5063 (#5018's login-expiry notice) for 0.7.20

Card: kosmos#5018. #5063 merged 2026-10-02 20:19Z and was reverted (#5077, Baron) for the 0.7.19 re-cut: it turned
`render-gutter-return-4506` red at "G3b precondition: with no reserved gutter the band really straddles the pane
starting to scroll", 3 of 3 alone at the frozen sha, bisected to 124d24f9b. Splinter: re-land for 0.7.20 with a fix,
or show the check's control is stale.

## Done looks like
#5018's notice is back on main, and render-gutter-return-4506 passes with its G3 sweep still crossing the consolidated
Agents pane's scroll start, so it still tests the repaint loop it was written for.

## Finding (measured, this check's own sweep widened to 840..1000 by 8, file:// page, 1280 wide)
- Before #5063 (2da73952): the pane scrolls up to 928 and not from 936. The check's band (920..940 by 4) straddled it.
- With #5063 (main before the revert): scrolls up to 912 and not from 920. The band 920..940 never scrolls, so the
  precondition fails; every behaviour assertion (no loop, one width, the chart fits after a poll) still passes.
- #5063 moved the header's notices (and their slots) into a floating stack, so the header no longer holds them and the
  pane gained about 16px. The check's control is what went stale, not the chart's loop guard.

## Change
- Revert of the revert: 1953dc19b undone (only the code commit; the revert PR's own plan and proof stay).
- `docs/browser-checks/render-gutter-return-4506.js`: the G3 band moves to 904..924 by 4, straddling the new start
  (912 scrolls, 920 does not), with the two measurements in its comment.

## Validation
- render-gutter-return-4506 on this branch: all G3/G3b assertions pass, the precondition included.
- Surface gate (#2518) named four checks whose tokens #5063 changes (render-shell-noscroll-4872, render-restart-screen-4343,
  render-plus-bar-3837, render-phone-offline-718): each run on this branch; results recorded below before the PR.
- Coarse gate (#1720): pass.

## Decisions
- Move the band, not the notice: the notice's placement is Josh's ruling for #5018 (float centred under the
  navigation, taking no header room), and the measured shift is the expected result of it.
- Rejected: a self-calibrating sweep (search for the scroll start first). More machinery; the fixed band with a
  precondition that proves it straddles the start fails loudly the next time the layout moves, which is what it did.
- Weakest premise: that 904..924 keeps a margin on both sides of the start in CI's browser (Chromium, same version
  pin as here); the precondition will say so if not.
