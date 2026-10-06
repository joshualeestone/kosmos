# gutter-5379: the top header jumps 15px when the view flips, on platforms whose scrollbars take width

kosmos#5379. `render-tophead-stable-2624` is red in CI (first seen on #5305, and on main in the 10-05 nightly, run 37357365611): 9 desktop rows, at 1440/1100/960, the right controls 15px apart between the tab view and consolidated, the centred tabs 7.5px.

## Why
The tab view reserves the scrollbar gutter on `<html>` (`scrollbar-gutter: stable`, outside consolidated only, on purpose: consolidated's panes scroll inside, not the page). Where a scrollbar takes width (Windows, Linux, and GitHub's macOS runner, which prints `no sideways scroll -15`), the tab view's header therefore ends 15px short of the window edge and consolidated's does not. On a Mac with overlay scrollbars the width is 0, so it never shows there.

## Call
Mona chose "no jump" over "reserve the gutter in both views" (an empty 15px strip in consolidated). So consolidated pads its header's right side by the same measured width, `var(--scrollbar-width)`, under `html[data-scrollbar-measured][data-layout="consolidated"]`, desktop only (the same `min-width: 56.01rem` block as the #3497 tab-view rule). The width comes from the existing #3497 measure, `kosmosMeasureScrollbarWidth`, which returned early in consolidated; that early return is removed so the width is measured there too.

Specificity: the new rule is (0,4,2), above consolidated's `padding: 0` reset (0,3,2), so order does not matter. Its right padding is 0 on overlay-scrollbar machines, which is what that reset gave before: no change on a Mac.

Rejected:
- `html { scrollbar-gutter: stable }` in both views: the empty strip Mona declined.
- Loosening the check: its assertions are right; the header really moves on Windows.

## Evidence
- macOS: `render-tophead-stable-2624` OK at 020f9df77 (width 0, unchanged), as on main.
- Classic scrollbars: this Mac cannot draw them (headless, headed, without `--hide-scrollbars`, with the overlay feature off: all width 0). Measured on GitHub's macOS runner by dispatching `browser-checks-full` on throwaway branches: fix (020f9df77 + empty commit) and control (its base 2b75277e9 + empty commit). Pass = 2624 green on the fix AND red on the control.

## Not measured
- Windows WebView2 itself (the product's classic-scrollbar platform): the runner's Chromium is the proxy.
- The measure now also runs in consolidated, where it briefly sets the root's gutter and overflow inline and restores them; the DM thread's scroll position is saved and restored as before.
