# header-stable-2624: the top header sits on the same pixels in every view

Addresses #2624 (Josh: "flipping between views must not jitter or shift by a single pixel").

## Measured before (served 0.6.95, live board, real Chromium; applyLayout(x, true), not saved)
| width | view | K switcher / You top | header height |
|---|---|---|---|
| 1440 | tab | 49.9 | 126.9 |
| 1440 | consolidated | 16.9 | 66.9 |
| 1100 | tab | 109.3 | 245.6 |
| 1100 | consolidated | 16.9 | 66.9 |
With no notices: tab 25 vs consolidated 9 (16px), and the bottom rule at 76 vs 50.

## Cause
- The tab view's header sat inside `.apphead`'s 24px top padding; consolidated is flush with
  8px (Josh #1303, no band across the top).
- Both views CENTRED the header row, which also holds the update and login notices. A tall
  notice (they wrap tall in the tab view, squeezed by the centred tabs) pushed the controls
  down in either view.
- The tab view's header had 14px bottom padding (plus its 4px margin) against 8px.

## Change (web/index.html, CSS only)
- A `@media (min-width: 960px)` block after the `.apphead header` rules. 960px is
  layoutConsolidated's floor, so this is exactly the range where the views can be switched:
  the tab view's `.apphead` loses its top padding, its header gets consolidated's 8px top and
  a 4px bottom (the rule lands at y=50 in both), and both views top-align the row and
  `.headleft`. The 32px switcher and You get 1px so they centre on the 34px K mark, where the
  centred row put them when no notice showed.
- The consolidated header rule: `align-items: center` -> `flex-start`.
Below 960px only the tab view exists, so nothing can jump; it keeps its own spacing.

## After (live board with the CSS injected, and the hermetic check)
K mark 8, switcher and You 9, rule 50, in both views at 1440 and 1100, notices on and off.
A notice now grows the bar downward. In the tab view the active-tab underline sits on the
bottom rule.

## Check
docs/browser-checks/render-tophead-stable-2624.js (hermetic). Green; red on origin/main with
20 problems, all header movement. Wired: browser-checks.sh loop, README row, reason-grep
counts 164->165 and 108->109 (measured).

## Not changed
- The light/dark and view switches live in the You menu (#3051), a later design call.
- The 800px tab view (burger) keeps its own geometry; the check pins that the scope did not leak.

## Weakest premise
That consolidated's flush bar is the reference both views should match, not the tab view's
taller one. It follows Josh's #1303 ruling (no band across the top) and #2282 (consolidated
is the newer mock), but it is a visible change to the tab view: the bar is 26px shorter.
