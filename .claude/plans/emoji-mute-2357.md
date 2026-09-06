# emoji-mute-2357: mute the composer emoji-picker button to a subtle grey

kosmos#2357. Josh (2026-09-06, #admin): "In the dialogue I love that we added emojis, but
instead of the yellow smiley can we grey it out so it's not so prominent" (matching
Discord's muted grey smiley). Fast-follow for the 0.6.40 cut (low pressure; rides the next
build).

## Problem

The composer emoji-picker button (`#pj-emoji-btn`, `.emojibtn`) renders a bright yellow
color-emoji grinning face (`&#128512;` 😀). It reads as prominent where Josh wants a subtle
affordance.

## Fix

Wrap the decorative glyph in a `<span class="emojibtn-glyph" aria-hidden="true">` and apply
`filter: grayscale(1) opacity(.6)` to that span. A color-font emoji renders its own colors,
so CSS `color` cannot recolor it; a paint `filter` can, and `grayscale(1)` desaturates the
yellow to grey while a modest opacity recesses it without reading as disabled. Same
technique as the existing `.pmark.dim svg { filter: grayscale(1) opacity(.8) }` precedent.

Filtered on the GLYPH span, not the `.emojibtn` button, so the button's hover / focus /
`aria-expanded` affordance backgrounds stay at full strength. The button keeps its
`aria-label="Add an emoji"` (the accessible name), and the now-decorative glyph is
`aria-hidden` so it is not double-announced.

## Verification

- `docs/browser-checks/render-emoji-mute-2357.js`: asserts (in a real DOM) the glyph carries
  a computed `grayscale(...)` filter, the filter is on the glyph and NOT the button, the
  glyph is present, and the aria-label + aria-hidden are correct. Control: the pre-fix
  bare-text glyph has no filter and reds. Registered in `tools/browser-checks.sh` + README.
- Isolated render (exact `.emojibtn`/`.emojibtn-glyph` CSS) confirms the yellow 😀
  desaturates to a soft muted grey, still clearly clickable, with the hover background
  unaffected. Reason-grep emit-site counts bumped (62->63, 37->38) for the new check.

## Follow-up

Reversible CSS. Josh eyeballs the exact grey on his re-test; the opacity is a one-line tune
if he wants it a touch more or less prominent.
