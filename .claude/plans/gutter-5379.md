# gutter-5379: the top header jumps 15px when the view flips, on platforms whose scrollbars take width

kosmos#5379. `render-tophead-stable-2624` is red in CI (first seen on #5305, and on main in the 10-05 nightly, run 37357365611): 9 desktop rows, at 1440/1100/960, the right controls 15px apart between the tab view and consolidated, the centred tabs 7.5px.

## Why
The tab view reserves the scrollbar gutter on `<html>` (`scrollbar-gutter: stable`, outside consolidated only, on purpose: consolidated's panes scroll inside, not the page). Where a scrollbar takes width (Windows, Linux, and GitHub's macOS runner, which prints `no sideways scroll -15`), the tab view's header therefore ends 15px short of the window edge and consolidated's does not. On a Mac with overlay scrollbars the width is 0, so it never shows there.

## Call
Mona chose "no jump" over "reserve the gutter in both views" (an empty 15px strip in consolidated). So consolidated pads its header's right side by the same measured width, `var(--scrollbar-width)`, under `html[data-scrollbar-measured][data-layout="consolidated"]`, desktop only (the same `min-width: 56.01rem` block as the #3497 tab-view rule). The width comes from the existing #3497 measure, `kosmosMeasureScrollbarWidth`. Its load-time run happens in <head>, before any layout is applied, so a board that boots in consolidated was already measured; but it returned early in consolidated afterwards, so a width that changed there (a zoom, another display, a scrollbar-mode change) stayed stale until a flip out. That early return is removed. A resize in consolidated measures once the drag settles (200ms), since a measurement there reflows the page.

The padding goes on the inner header, which carries consolidated's background and bottom rule, so they still reach the window edge: `padding-right: calc(var(--space-8) + var(--scrollbar-width))`. Specificity: (0,4,3), above consolidated's `padding: 8px var(--space-8)` rule (0,3,3), so order does not matter. On overlay-scrollbar machines it is --space-8, what that rule gave before: no change on a Mac. The Kosmos+ bar above the header (a remote session) had the same 15px jump (in the tab view kplusBarFit ends it at the reserved gutter), so it takes the same right padding in consolidated. With consolidated chosen, the whole-page tabs (Settings and the rest, where body is not .consolidated) reserve no gutter either, so they take the tab view's #3497 header rule, which pads by the width less what the page really gives up: their header ends where Agents and Projects' does whether or not the page scrolls. The Kosmos+ bar there follows: kplusBarFit, which cancels the header's padding with the bar's margins, also pads the bar's right side by that padding (wide only), so Log out ends with the header's right controls.

The measurer, now running in consolidated, briefly forces a gutter there, which narrows the page for one layout; it saves and restores every scrolled inner element in consolidated, and the once-a-second pointer-press re-measure is skipped in consolidated (load, resize, focus, a return to the tab and a view flip still measure).

Rejected:
- `html { scrollbar-gutter: stable }` in both views: the empty strip Mona declined.
- Loosening the check: its assertions are right; the header really moves on Windows.

## Evidence
- A 15px width set by hand in the 2624 check reproduces CI's red on this Mac without the fix (youX 1331.1 vs 1316.1, tabsX 627 vs 619.5) and passes with it; a Kosmos+ bar arm (consolidated: Log out ends with the header's right controls) reds without the bar rule (1416 vs 1401). Both measured.
- macOS: `render-tophead-stable-2624` OK (width 0, unchanged), as on main. Its new arm (the measurer run while in consolidated) reds with the old early return restored (measured on a scratch copy).
- Classic scrollbars: this Mac cannot draw them (headless, headed, without `--hide-scrollbars`, with the overlay feature off: all width 0). Measured on GitHub's macOS runner by dispatching `browser-checks-full` on throwaway branches: fix (020f9df77 + empty commit) and control (its base 2b75277e9 + empty commit). Pass = 2624 green on the fix AND red on the control.

## Not measured
- Windows WebView2 itself (the product's classic-scrollbar platform): the runner's Chromium is the proxy.
- Whether the one-layout reflow in consolidated is visible on a classic-scrollbar platform (it is forced and restored in one task, so nothing should paint between).
- Scroll events: if scroll anchoring moves an inner scroller during the forced layout, the move and the restore each queue a scroll event, so a position-reading scroll handler may run once per measurement in consolidated (load, settled resize, focus, a return to the tab). Not observed either way.
- The scroll restore itself: on an overlay-scrollbar machine nothing reflows, so no local check can red without it; only a classic-scrollbar run exercises it.
- An engine whose 100vw excludes a reserved gutter is never marked measured (A1t), so neither view gets the #3497/#5379 padding there and the 15px jump remains on it; that is the existing A1q fallback, not new.
- Cost in consolidated: each measurement there walks every element under body and forces two page layouts (forced gutter, then restored), on load, every window focus and return to the tab, a settled resize and a flip. Focus and return to the tab are frequent; the cost is not measured. Kept rather than a list of known scrollers, which would go stale as panes are added, and rather than skipping when the window size is unchanged, which would miss the mouse plug-in case the focus trigger exists for.
- A Mac set to "Automatic" that switches scrollbar mode on a mouse plug-in fires no resize; the tab view catches it on the next press, consolidated only on a focus, a return to the tab or a flip (the press re-measure is skipped there).
- The classic-scrollbar CI result is recorded on card #5379, not here: this file is written before it lands.
