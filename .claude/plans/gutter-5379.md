# gutter-5379: the top header jumps 15px when the view flips, on platforms whose scrollbars take width

kosmos#5379. `render-tophead-stable-2624` is red in CI (first seen on #5305, and on main in the 10-05 nightly, run 37357365611): 9 desktop rows, at 1440/1100/960, the right controls 15px apart between the tab view and consolidated, the centred tabs 7.5px.

## Why
The tab view reserves the scrollbar gutter on `<html>` (`scrollbar-gutter: stable`, outside consolidated only, on purpose: consolidated's panes scroll inside, not the page). Where a scrollbar takes width (Windows, Linux, and GitHub's macOS runner, which prints `no sideways scroll -15`), the tab view's header therefore ends 15px short of the window edge and consolidated's does not. On a Mac with overlay scrollbars the width is 0, so it never shows there.

## Call
Mona chose "no jump" over "reserve the gutter in both views" (an empty 15px strip in consolidated). So consolidated pads its header's right side by the same measured width, `var(--scrollbar-width)`, under `html[data-scrollbar-measured][data-layout="consolidated"]`, desktop only (the same `min-width: 56.01rem` block as the #3497 tab-view rule). The width comes from the existing #3497 measure, `kosmosMeasureScrollbarWidth`, which returned early in consolidated; that early return is removed so the width is measured there too.

The padding goes on the inner header, which carries consolidated's background and bottom rule, so they still reach the window edge: `padding-right: calc(var(--space-8) + var(--scrollbar-width))`. Specificity: (0,4,3), above consolidated's `padding: 8px var(--space-8)` rule (0,3,3), so order does not matter. On overlay-scrollbar machines it is --space-8, what that rule gave before: no change on a Mac.

The measurer, now running in consolidated, briefly forces a gutter there, which narrows the page for one layout; it saves and restores every scrolled inner element in consolidated, and the once-a-second pointer-press re-measure is skipped in consolidated (load, resize, focus, a return to the tab and a view flip still measure).

Rejected:
- `html { scrollbar-gutter: stable }` in both views: the empty strip Mona declined.
- Loosening the check: its assertions are right; the header really moves on Windows.

## Evidence
- macOS: `render-tophead-stable-2624` OK (width 0, unchanged), as on main. Its new arm (a board measured while in consolidated) reds with the old early return restored (measured on a scratch copy).
- Classic scrollbars: this Mac cannot draw them (headless, headed, without `--hide-scrollbars`, with the overlay feature off: all width 0). Measured on GitHub's macOS runner by dispatching `browser-checks-full` on throwaway branches: fix (020f9df77 + empty commit) and control (its base 2b75277e9 + empty commit). Pass = 2624 green on the fix AND red on the control.

## Not measured
- Windows WebView2 itself (the product's classic-scrollbar platform): the runner's Chromium is the proxy.
- Whether the one-layout reflow in consolidated is visible on a classic-scrollbar platform (it is forced and restored in one task, so nothing should paint between).
