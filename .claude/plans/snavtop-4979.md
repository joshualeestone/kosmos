# #4979: Settings' nav pills no longer slide under the app header

**Done looks like:** on the Settings tab, every section, scrolled anywhere, at any desktop width and
with either layout saved, every nav pill sits below the app header and a click on the first one lands
on it while the nav is stuck; on a window too short to hold the whole nav below the header, the nav
scrolls with the page instead of hiding pills; and in the consolidated view (Settings opened from the user menu, inside Projects) the nav
sticks where it did before.

## Cause
`.snav { position: sticky; top: 16px; }` (#350). On the Settings tab the app header (`.apphead`) is
sticky at the top too and drawn above the page (z-index 20), so the stuck nav sat under it. Found
while fixing #4961 (c).

## Change
- web/index.html CSS: `body:not(.consolidated) #s-nav { top: calc(var(--apphead-h, 0px) + 16px); }`.
  Unmeasured, it is the old 16px. Not in the consolidated view (body.consolidated): Settings is its
  own scroll box inside Projects there and the header is static, so the nav keeps its 16px from the
  panel's top. Below 56rem `.snav` is static, so a phone is unchanged.
- One small script beside the #s-nav click handler writes the header's border-box height into
  `--apphead-h` on the root, once and on every resize of the header (ResizeObserver). It skips an
  element with no real numeric height (two web.* harnesses run the page against a stub document).
- `@media (max-height: 35rem)`: the Settings nav is static (scrolls with the page). The whole nav
  needs 543px below the top (11 pills, 434px, under a header of up to 77px, 16px either side,
  measured); a stuck nav on a shorter window hung its last pills off the bottom and, at the page's
  end, pushed its first ones back under the header.
- docs/browser-checks/render-snav-head-4979.js (+ README row, gated.txt).

## Rejected
- `max-height` + `overflow-y: auto` on the nav for short windows: any overflow but visible clips the
  pills' focus rings at the nav's edges on every window, a keyboard regression.
- A fixed top (51px + 16px): the header is 77px at 900px wide, where it wraps, so a fixed value still
  hides the first pill there (measured, both engines, with either layout saved).
- Making the Settings nav static like the agent page's (#4961 c): Settings has nothing below its nav,
  so a sticky nav costs nothing there once it clears the header.
- Zeroing the offset from the script when the header is not sticky: the header's position flips with
  the body class, which no resize reports, so the CSS keys on the class instead.

## Evidence
- Header height on the Settings tab, measured: 51px at 1100, 1440 and 1800px wide; 77px at 900px;
  the same with either layout saved, on both engines.
- Consolidated view, measured on main: the nav sticks 40px below the panel's top (24px padding + 16)
  at the top and scrolled to the end. An unscoped offset moved it to 91px and 70px.
- The check, three ways: with the change, all pass (69 PASS lines). On main, 32 FAIL, exactly the
  Settings-tab placement and click arms, no consolidated-view arm red. With the offset unscoped (no
  body:not(.consolidated)), exactly the 4 consolidated-view arms red. A fixed `top: 67px` reds exactly
  the 900px arms. Without the short-window rule, exactly the 8 short-window arms red.
- Short windows, measured on main and with the offset alone: at 1200x480 and 900x520 the stuck nav
  hid pills (under the header on main everywhere; off the bottom mid-scroll and under the header at
  the end with the offset), which is what the short-window rule removes.

## Weakest premise
Two. The 35rem threshold is measured for today's 11 pills: more pills, or a larger text size, need a
taller window before the nav sticks safely (the short-window arms would then catch a stuck nav that
hides a pill at 1200x480 or 900x520, but not between those heights and 35rem). And that `body.consolidated` is the only state where the header does not stick above Settings. The
agent page's Talk view also makes the header static, but #s-nav is not on that page. A new state that
moves Settings into another scroll box would need the same exclusion.
