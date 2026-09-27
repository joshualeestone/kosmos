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
- `.tv-mh` aligns to flex-start, so the total sits top-right beside the name.
- `.tv-nm` is `min-width: 0`.

Every card's header is now the same two lines: the name, then the tag.

## Browser check (docs/browser-checks/render-token-usage-2617.js)

At 1280 (desktop), 600 (the tightest two-column width) and 390 (phone), for all four cards:
- the name's own text is on one line (a Range over the name's text node, since the name span also
  holds the tag);
- the tag starts below the name;
- the total is on one line;
- the four header heights match within 1px.

## Weakest premise

The names are short enough to fit on one line beside the total at 600px. A longer class name, or a
translated one, could wrap again. The check would then go red rather than pass silently.
