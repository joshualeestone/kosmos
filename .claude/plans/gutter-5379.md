# gutter-5379: the top header jumps 15px when the view flips, on platforms whose scrollbars take width

kosmos#5379. `render-tophead-stable-2624` is red in CI (first seen on #5305, and on main in the 10-05 nightly, run 37357365611): 9 desktop rows, at 1440/1100/960, the right controls 15px apart between the tab view and consolidated, the centred tabs 7.5px.

## Why
The tab view reserves the scrollbar gutter on `<html>` (`scrollbar-gutter: stable`, outside consolidated only, on purpose: consolidated's panes scroll inside, not the page). Where a scrollbar takes width (Windows, Linux, and GitHub's macOS runner, which prints `no sideways scroll -15`), the tab view's header therefore ends 15px short of the window edge and consolidated's does not. On a Mac with overlay scrollbars the width is 0, so it never shows there.

## Call
Mona chose "no jump" over "reserve the gutter in both views" (an empty 15px strip in consolidated), and approved the padding fix at 09:26. So consolidated pads its header's right side by the same measured width, `var(--scrollbar-width)`, under `html[data-scrollbar-measured][data-layout="consolidated"]`, desktop only (the same `min-width: 56.01rem` block as the #3497 tab-view rule). The width comes from the existing #3497 measure, `kosmosMeasureScrollbarWidth`, unchanged: its load-time run happens in <head>, before any layout is applied, so a board that boots in consolidated is measured, and a flip out of consolidated re-measures (A1u).

The padding goes on the inner header, which carries consolidated's background and bottom rule, so they still reach the window edge: `padding-right: max(var(--space-8), calc(var(--space-8) + var(--scrollbar-width) - 100vw + 100%))`, the width less what the page really gives up, as in the tab view's rule. On overlay-scrollbar machines it is --space-8, what that rule gave before: no change on a Mac. The Kosmos+ bar above the header (a remote session) had the same 15px jump, so it takes the same right padding in consolidated (one rule). With consolidated chosen, the whole-page tabs (Settings and the rest, where body is not .consolidated) reserve no gutter either, so they take the tab view's #3497 header rule; kplusBarFit pads the bar's right side to match there (wide only), so Log out ends with the header's right controls.

Rejected:
- `html { scrollbar-gutter: stable }` in both views: the empty strip Mona declined.
- Loosening the check: its assertions are right; the header really moves on Windows.

## Trim (review 17, blind)
A blind review approved the padding fix and found about half the diff was scope creep from the self-review loop. Trimmed to its table: the measurer rework (running in consolidated, the scrolled-element save and restore, the 200ms consolidated resize settle, the scrollbarThickness probe gating press, focus and return) is cut and main's measurer restored, with its early return in consolidated; the matching 2624 arm, 2622 A1u comment, applyLayout comment and README clause are cut too. The long comments are shortened. Kept: the consolidated header and Kosmos+ bar rule, the whole-page selector, kplusBarFit's whole-page padding, and the 2624 hand-set 0px/15px, whole-page and Kosmos+ bar arms and the 2622 A1o scope arm.

Deferred (follow-up card): if the scrollbar width changes WHILE in consolidated (zoom, a Mac on Automatic gaining a mouse), the header moves by that difference once, on the next flip out.

## Evidence
- A 15px width set by hand in the 2624 check reproduces CI's red on this Mac without the fix (youX 1331.1 vs 1316.1, tabsX 627 vs 619.5) and passes with it; a Kosmos+ bar arm (consolidated: Log out ends with the header's right controls) reds without the bar rule (1416 vs 1401). Both measured.
- macOS: `render-tophead-stable-2624` OK (width 0, unchanged), as on main.
- Classic scrollbars: this Mac cannot draw them. Measured on GitHub's macOS runner by dispatching `browser-checks-full` on throwaway branches, fix (020f9df77) and control (its base 2b75277e9): that run is of the FIRST version only. The classic-scrollbar CI pair must be re-run on the trimmed head (pending).

## Not measured
- Windows WebView2 itself (the product's classic-scrollbar platform): the runner's Chromium is the proxy.
- An engine whose 100vw excludes a reserved gutter is never marked measured (A1t), so neither view gets the #3497/#5379 padding there and the 15px jump remains on it; that is the existing A1q fallback, not new.
- A consolidated window too short for its grid scrolls the page; the rules subtract what the page gives up (100vw - 100%), so a real scrollbar is not counted twice. No check makes such a window.
- Between 56rem and 960px with consolidated chosen, body is never .consolidated, so those widths take the whole-page rule too; correct by the same formula, but no check row sits in that band.
- render-talk-fill-2622's A1o scope arm asserted the old behaviour (an agent's Talk page with consolidated chosen kept the plain padding); it now asserts the full-width padding.
