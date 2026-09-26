# phone-ready-718: the org chart fits a phone

Issue: kosmos #718 (Liu Kang m927: survey the board screens not yet phone-ready, fix the worst).
Survey table: https://github.com/joshualeestone/kosmos/issues/718#issuecomment-5842472848

## Problem
The org chart canvas is a fixed square, `(maxR + 78) * 2` px (396px for the sample fleet of five, which made the page 420px wide), drawn at
that width whatever the screen. On 375, 393 and 412px phones the whole board scrolled sideways (every shot under
430px wide that the sweep took, 6 Chromium and 2 WebKit, flagged by mobile-shots.js). It was the only screen in the sweep that overflowed.

## Done looks like
At every harness phone size, in light and dark, Chromium and WebKit, the org chart view has no sideways
scroll, every agent is still drawn, and each face stays a full 44px tap target. A desktop-width board draws
exactly the chart it drew before.

## Change
1. `orgFit(maxR, avail)`: when the natural square does not fit the width, give up the room around the outer
   ring first (78px down to 30px, the drag box's own margin), then bring the rings in (radii x k, k >= 0.7).
2. `paintOrg` measures `#orgview`'s width, applies the fit, and resets remembered positions when the canvas
   size changes (they are in another frame).
3. A resize that changes the chart's width repaints it (rotation); height-only resizes (address bar) do not.
4. `.orgwrap { overflow-x: auto }`: a fleet too big even at the floor scrolls inside its box, not the page.
The harness additions the sweep used (the new screens, tap and field measurement) ship separately with
the harness itself (branch mobile-shots), which has not reached main yet.

## Rejected
- `transform: scale()` / `zoom` on the drawing: shrinks a 44px face to ~34px on an iPhone SE (under the tap
  floor) and breaks the drag's pointer maths.
- Letting `.orgwrap` scroll on its own for every fleet: the map sets `touch-action: none` for dragging, so a
  swipe on the chart could not pan it, and half the chart would sit off screen by default.

## Weakest part
The squeeze floor (0.7) is a judgement: below it the relaxation's node spacing fights the ring pull. A fleet
that big on a phone falls back to scrolling inside the chart's box. Names on the chart are still hover-only,
and a phone has no hover: a tap opens the agent. Changing that is a design call for Josh, not part of this fix.

## Tests
- `web.orgchart-phone-718.test.js`: desktop unchanged, hidden (no width) unchanged, phone widths fit with
  rings untouched, a deeper fleet squeezes and stops at the floor, paintOrg wiring, resize repaint + CSS.
  Control: against the unfixed page it fails.
- Browser: mobile-shots.js org chart at 4 sizes x 2 themes x 2 engines after the fix; the same harness
  flagged 8 overflows on the unfixed code (the control).
- Gate check `docs/browser-checks/render-orgchart-phone-718.js` (in tools/browser-checks.sh): real server,
  five-agent fleet, the four phone sizes plus desktop; page no wider than the screen, every face drawn, on
  screen, 44x44, a tap opens the agent; desktop draws the natural square.

## Results (2026-09-25)
- Harness, fixed: 48 of 48 shots clean (org chart, agents list and home x 4 sizes x 2 themes x 2 engines).
- Chart check (every face drawn, none off screen, none under 44px, a tap opens the agent), 4 sizes x 2 engines:
  fixed 0 of 8 bad; the SAME check on the unfixed page 6 of 8 bad (page 420 wide on a 375/393/412 screen;
  Pro Max fits either way). The chart now takes 326/344/364/382px on the four phones.

## Results (2026-09-26, rebased on origin/main 6fd0e56d8)
- render-orgchart-phone-718, ENGINES=chromium,webkit: fixed 50 of 50 PASS. Control (origin/main's
  web/index.html swapped in): 44 PASS, 6 FAIL, exactly "no sideways scroll" at 375/393/412 in both engines
  (page 420/421px). The other arms stay green on main: the faces sit mid-chart, so they are not the control.
- Unit + wiring tests (orgchart-phone, browser-checks wired/selectors/reason-grep/home, fixture-discipline,
  every-test-runs): 52 of 52.
