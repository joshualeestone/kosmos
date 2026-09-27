# usagecards-4242: Token Usage class cards keep a two-line header in the two-column grid (#4242)

## Why

Mona Lisa's 0.7.03 design walk (served staging build) found the class cards below the Token Usage tiles
(Cache reads, Cache writes, Output, Input) with their titles wrapped to three cramped lines, for
example "Cache / reads context / ingested", beside the number. Input fit on one line, so the header
heights differed within a row. The name, its tag and the total shared one flex row, with the tag inline
after the name.

## The change (web/index.html, CSS only)

- `.tv-tg` is `display: block` under the name (margin-top 2px, no left margin), so the tag has its own line.
- `.tv-tot` is `white-space: nowrap`, so the total never wraps.
- `.tv-mh` keeps `align-items: baseline`: a block tag leaves the name's first line as the item's baseline,
  so the total still shares the name's baseline (the property #4083 pins for the tiles above).

Every card's header is now the same two lines: the name, then the tag.

## Browser check (docs/browser-checks/render-token-usage-2617.js)

At 1280 (desktop), 561 (the tightest two-column width: the grid stacks at a 560px viewport query, and
1280 is tighter than 600 because the settings column is capped) and 390 (phone), for all four cards:
- the name's own text is on one line (a Range over the name's text node, since the name span also
  holds the tag);
- the tag starts below the name;
- the total is on one line;
- the four header heights match within 1px;
- the name's text ends before the total starts.

Then at 561 with the widest total forced into every card (`1000.0M` and `0.91%`): the total is on one
line and each name still fits on one line, clear of it. The fixture's own totals fit even without
`nowrap`, so this is the arm that goes red if the total is allowed to wrap.

## Review 1

- Measured at 561, not 600: 600 was not the tightest two-column width.
- `.tv-mh` back to `baseline` (flex-start lost the name/total baseline); `min-width: 0` dropped, so a
  long word cannot paint under the total.
- The one-line-total arm can now fail: a wide-total injection at 561.
- README row names #4242.
- Not changed: the grid's switch is a viewport query where a container query would fit better. That
  predates this branch.

## Weakest premise

The names are short enough to fit on one line beside the total at 561px. A longer class name, or a
translated one, could wrap again. The check would then go red rather than pass silently.
