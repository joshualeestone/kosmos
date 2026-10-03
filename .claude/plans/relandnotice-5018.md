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
- `docs/browser-checks/render-gutter-return-4506.js`: the G3 band moves to 900..932 by 4, straddling the new start
  (912 scrolls, 920 does not) with room either side, with the two measurements in its comment.
- `web/index.html` (review 1): #4979 (merged after #5063) sticks the Settings nav below the measured header
  (`--apphead-h`), assuming a notice grows the header. With notices floating, a notice covered the first pills.
  `#s-nav` now also adds `--topnotes-h` (the floating stack's height, 0 with none), and the snav-loose fit test adds
  the stack's height and observes it. The #4979 comments that said notices grow the header now say they float.
- `docs/browser-checks/render-snav-head-4979.js`: a floating-notice arm (a 460x90 notice in #login-adv-slot, 900x700,
  scrolled halfway): every pill below the stack, and the first pill takes the click (hit-test), both engines.

## Validation (2026-10-02, this branch, headless, one light queue turn each)
- render-gutter-return-4506: all G3/G3b pass, the precondition included, at band 904..924 and again at 900..932.
- render-snav-head-4979 with the floating-notice arm: pass, chromium and webkit. MUTANT (the `--topnotes-h` term
  removed from #s-nav's top): the arm fails in both engines (two pills under the notice, the first not clickable).
- The four checks the surface gate (#2518) named, each run on this branch, exit 0: render-shell-noscroll-4872 (19:46),
  render-restart-screen-4343 (19:50), render-plus-bar-3837 (19:56), render-phone-offline-718 (20:01, at 4c87b38df).
  Recorded as per-check `Browser-check-surface:` trailers. Both gates pass (coarse #1720, surface #2518).

## Decisions
- Move the band, not the notice: the notice's placement is Josh's ruling for #5018 (float centred under the
  navigation, taking no header room), and the measured shift is the expected result of it.
- Rejected: a self-calibrating sweep (search for the scroll start first). More machinery; the fixed band with a
  precondition that proves it straddles the start fails loudly the next time the layout moves, which is what it did.
- Weakest premise: that 904..924 keeps a margin on both sides of the start in CI's browser (Chromium, same version
  pin as here); the precondition will say so if not.
