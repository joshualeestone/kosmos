# usagecards-4242: Token Usage class cards keep a two-line header in the two-column grid (#4242)

## Why

Mona Lisa's 0.7.03 design walk (served staging build) found the class cards below the Token Usage tiles
(Cache reads, Cache writes, Output, Input) with their titles wrapped to three cramped lines, for
example "Cache / reads context / ingested", beside the number. Input fit on one line, so the header
heights differed within a row. The name, its tag and the total shared one flex row, with the tag inline
after the name.

## The change (web/index.html, CSS only)

- `.tv-tg` is `display: block` under the name (margin-top 2px, no left margin), so the tag has its own line.
- `.tv-tot` is `white-space: nowrap`. Measured inert on today's markup: the number and its share are
  adjacent with no space, so the total has no break opportunity at any width (removing `nowrap` left every
  arm green, including one that squeezed a card to about 170px). It stays as a guard against a future
  space between them; no arm claims to test it.
- `.tv-mh` keeps `align-items: baseline`: a block tag leaves the name's first line as the item's baseline,
  so the total still shares the name's baseline (now measured, see the check).
- The cards stack to one column once `#s-sec-usage` (already an inline-size container) is 540px or
  narrower, replacing the `@media (max-width: 560px)` viewport query.

Every card's header is now the same two lines: the name, then the tag.

## Browser check (docs/browser-checks/render-token-usage-2617.js)

At 1280 (desktop, the capped 544px column), a 541px usage section (the narrowest two-up), a 540px
section (the widest stacked) and 390 (phone), for all four cards:
- two-up or stacked as expected, with the window sized to give the section, so a scrollbar cannot
  move a fixed window width across the 540px line;
- the name's own text is on one line (a Range over the name's text node, since the name span also
  holds the tag);
- the tag starts below the name;
- the total is on one line, clear of the name and inside the card;
- the total sits on the name's baseline (a zero-size inline-block marks each line's baseline);
- the four header heights match within 1px.

At a 1280 window, a 500px section stacks the cards and a full one does not, so the stacking follows the
section, not the window.

Then at 1280 and a 541px section with the widest total that occurs in practice forced into every card
(`999.9M`, the last M value, beside `99.9%`), the same header arms hold. Past it (`1000.0M`, a #4244
rounding edge, beside `100.0%`, which needs one class to hold 99.95% of every token) "Cache reads" and
"Cache writes" take two lines, measured; there the check pins only that the total stays on one line,
inside the card and clear of the name. The fixture's own totals
fit even without `nowrap` (see above), so these arms pin the fit, not the nowrap.

## Review 1

- Measured at 561, not 600: 600 was not the tightest two-column width.
- `.tv-mh` back to `baseline` (flex-start lost the name/total baseline); `min-width: 0` dropped, so a
  long word cannot paint under the total.
- The one-line-total arm can now fail: a wide-total injection at 561.
- README row names #4242.

## Review 1 follow-through: the wide total wrapped a name at 561

With the widest total forced in at 561, a name wrapped (`Cache reads` with `1000.0M`, `Cache writes`
with `999.9M 99.9%`). A width probe across 561 to 1280 put the line between a 226px card (a 513px
section, wraps) and a 236px card (the capped 544px section, fits), and 561 was the only two-up width
below it. So the reviewer's container-query nit was the fix: the cards now stack on the section's
width, at 540px or narrower.

- `1000.0M` was the wrong widest total: usageAbbr goes to B at 1e9, so `999.9M` is the widest normal
  M total. The exception is a rounding edge (999.95M up to 1e9 renders `1000.0M`, where it should read
  `1.0B`); that is a usageAbbr defect, filed as #4244 rather than fixed here.

## Review 2

- The two-up and stacked arms size the window for a 541px and a 540px section instead of fixed 589 and
  561 windows, which a visible scrollbar moved across the line (the reviewer measured it with 15px).
  That also pins the threshold to 540 exactly, where the old arms allowed 514 to 540.
- A 500px section at a 1280 window must stack: a viewport query of any width passed the old arms.
- The name/total baseline is measured, since flex-start and flex-end both passed before.
- The clear arm also requires the total inside the card. The reviewer reported `1000.0M` fitting (its
  share unstated); beside `100.0%` two names wrap even at desktop (measured), so `999.9M 99.9%` is pinned as the widest
  in practice and the extreme is pinned to degrade cleanly (#4244 files the `1000.0M` edge).
- The CSS comment's card width is 238px, as measured; the README row says only what the arms pin.

## Weakest premise

The names are short enough to fit on one line beside the total in a 236px card (the capped desktop column), with about 10px to spare at the widest total. A longer class name, or a
translated one, could wrap again. The check would then go red rather than pass silently.
