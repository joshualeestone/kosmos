# #3129: the "Other Agents" rule runs the members rail's full width

## The report
Josh (0.6.68): the rule above "Other Agents" in the project members rail does not extend all the way to the left edge.

## Measured before the fix (headed Chromium, real GPU, live board, 1280 / 1440 / 1728 px)
| what | left | right |
|---|---|---|
| composer box vs its column | 16 px | 17 px (the 1 px is the column's border) |
| Tasks / Files divider | 0 | 0 |
| rule above "Other Agents" | 14 px | 10 px |

Cause: `.alist-grouphdr` had `margin: 6px 2px 2px 6px` inside the rail's 8 px padding.

## Change (web/index.html)
- `.alist-grouphdr`: `margin: 6px -8px 2px -8px; padding: 8px 10px 0 14px;`. The negative margins cancel the rail padding,
  so the border runs edge to edge; the padding puts the label and its + exactly where they were (14 px and 10 px in).
- Folded rail (`fold-a`): its existing rule resets the side margins to 0 and the side padding to 0, so the folded rule
  is unchanged.

## Rejected
- Keeping the rule inset but symmetric (2 px each side): Josh's words were "do not extend all the way to the left
  edge", and the Tasks / Files divider beside it is full width.

## Tests (docs/browser-checks/render-project-members-3387.js, light and dark)
- the rule reaches both edges (0 px each side): fails on main's CSS (14 / 10);
- the label and + stay at 14 px and 10 px: fails when the padding is mutated (label reads 8);
- folded, the rule still runs exactly edge to edge and the list cannot scroll sideways: removing the folded margin reset
  reds it (left -8, right -8, scrollWidth 55 in a 47 px list), and so does an inward shift (a 4 px margin reads left 4).

## Review
- Round 1 (opus, blind): 1 WARNING, fixed: the folded rail's margin reset was unasserted (now the folded arm). NITs: the
  folded padding reset is invisible (label and + are hidden there), accepted; #alist read three times, fixed.
- Round 2 (sonnet, blind): no BLOCKER, WARNING or CONVENTION. NIT fixed: the folded arm could not see an inward shift,
  now asserts exactly edge to edge. NITs accepted: the fold is simulated by the class (the fold CSS is purely
  class-driven); the folded padding reset stays unasserted.

## Design
Mona Lisa approved the design shots (~/work/design-shots/kosmos-3129) on 2026-10-04.

## Weakest premise
That this rail rule is the one Josh saw. The other two surfaces he could have meant measured symmetric, so it is the
only candidate left.
