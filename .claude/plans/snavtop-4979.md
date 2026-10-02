# #4979: Settings' nav pills no longer slide under the app header

**Done looks like:** on every Settings section, scrolled anywhere, at any desktop width and in both
layouts, every nav pill sits below the app header and a click on the first one lands on it.

## Cause
`.snav { position: sticky; top: 16px; }` (#350). The app header (`.apphead`) is sticky at the top too,
and drawn above the page (z-index 20), so the stuck nav sat under it. Found while fixing #4961 (c).

## Change
- web/index.html CSS: `#s-nav { top: calc(var(--apphead-h, 0px) + 16px); }`. Unmeasured, it is the
  old 16px. Below 56rem `.snav` is static, so a phone is unchanged.
- One small script beside the #s-nav click handler writes the header's border-box height into
  `--apphead-h` on the root, once and on every resize of the header (ResizeObserver).
- docs/browser-checks/render-snav-head-4979.js (+ README row, gated.txt).

## Rejected
- A fixed top (51px + 16px): the header is 77px at 900px wide, where it wraps (measured, both engines,
  both layouts), so a fixed value still hides the first pill there.
- Making the Settings nav static like the agent page's (#4961 c): Settings has nothing below its nav,
  so a sticky nav costs nothing there once it clears the header.

## Evidence
- Header height, measured: 51px at 1100, 1440 and 1800px wide; 77px at 900px; same in both layouts and
  both engines.
- On main: 32 FAIL (every placement and click arm, all 16 runs), no control red.
- With the change: all pass (57 PASS lines).

## Weakest premise
That the header is the only thing drawn above the page at the top. A future sticky bar between the
header and the content would need its height added here too.
