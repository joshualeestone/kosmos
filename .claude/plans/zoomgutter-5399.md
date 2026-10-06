# zoomgutter-5399: a zoom in the consolidated view re-measures the scrollbar width (kosmos#5399)

## Why
kosmosMeasureScrollbarWidth (web/index.html) returns early in the consolidated layout, because measuring there forces
a whole-page reflow (consolidated reserves no gutter). #5379 (Renet) pads consolidated's header by --scrollbar-width,
so a scrollbar width that changes while consolidated is showing (a zoom) left that padding stale until the next flip
out, which then moved the header once. Deferred from #5379's blind review.

## Change
- kosmosMeasureScrollbarWidth(opts): `{ inConsolidated: true }` measures in consolidated too. It records
  devicePixelRatio at each measurement (kosmosMeasuredRatio).
- The resize handler passes inConsolidated only when devicePixelRatio changed since the last measurement: a zoom pays
  one reflow, a plain resize in consolidated still measures nothing. Every other trigger is unchanged.
- Independent of #5379's CSS: on main nothing in consolidated reads --scrollbar-width yet, so this only keeps the
  variable current (Renet 09:49: #5379 no longer touches the function).

## Tests
docs/browser-checks/render-talk-fill-2622.js A1v (devicePixelRatio stubbed; a headless page cannot zoom): a planted
99px is kept by a plain resize and by a second resize at the same zoomed ratio, and replaced by the zoom. Ran alone
headless: all pass. Red with main's web/index.html (the zoom arm fails) and red with every resize measuring (the plain
arm fails). render-shell-noscroll-4872.js (flagged by the surface gate for the word "consolidated"): 72/72 on this
branch.

## Rejected
- Saving and restoring every scrolled element around a consolidated measure (about 60 lines; #5379 declined it).
- A matchMedia listener on resolution: it fires on the same zoom, and resize is already wired.

## Known limit
A Mac on "Automatic" scrollbars gaining or losing a mouse changes the width with no zoom, so this does not cover it;
the next flip out re-measures (the card's described one-time shift). Headless reads 0px, so the arm proves the measure
RUNS, not the Windows or Mac width itself (A1n covers real widths for the other arms).

Scroll positions in consolidated: the measure restores the window's and #d-dmthread's, not the other panes'
(#pj-list-view, #panel-settings, .tkcards and so on). Not saved and restored on purpose: it runs only on a zoom, which
already lays every pane out again at its new width in the same frame, and no test here could show the extra reflow
moving one (review 1).

## Weakest premise
That a zoom always changes devicePixelRatio in the Windows app (WebView2). It does in Chromium, whose engine WebView2 is.
