# replybar-4358: the message hover bar's order, Reply arrow and gold hover (#4358)

## Done looks like
- Every hover bar (rooms, DMs, and anywhere rxnsInner draws it) reads 👍 ❤️ 🔥 (grey smiley) then
  [↩ Reply] last. Reply carries a small stroke arrow icon (the app's 24-grid stroke set) before
  the word.
- Hovering Reply turns its outline the app's bright gold (--gold-bright), in light and dark.
- The 36px room/DM tap targets are unchanged (the same selectors still size .rxn-reply).
- render-room-reply-3745.js asserts order, arrow and gold hover in both themes;
  render-dm-reply-4256.js asserts order and arrow in the DM bar.

## Decisions
- "Far right" read as last in the floating bar (the bar is a pill that floats over the message),
  not pushed to the message's right edge.
- An SVG arrow, not an emoji, so it takes the button's colour and matches the app's icons.
- The keyboard focus ring stays the bar's 2px ink ring; only hover and focus border go gold.

## Weakest premise
The "far right" reading. If Josh meant the right edge of the message, it is one CSS line.
