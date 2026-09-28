# replybar-4358: the message hover bar (#4358) and Reply's @mention (#4359)

## Done looks like
- Every hover bar (rooms, DMs, and anywhere rxnsInner draws it) reads 👍 ❤️ 🔥 (grey smiley) then
  [↩ Reply] last. Reply carries a small stroke arrow icon (the app's 24-grid stroke set) before
  the word.
- Hovering Reply turns its outline the app's bright gold (--gold-bright), in light and dark.
- The 36px room/DM tap targets are unchanged (the same selectors still size .rxn-reply).
- render-room-reply-3745.js asserts order, arrow and gold hover in both themes;
  render-dm-reply-4256.js asserts order and arrow in the DM bar.

- #4359: Reply on an agent's room post puts "@<key> " (exactly what the @ picker inserts) at the
  start of the composer, cursor after it, so it goes to that agent only unless deleted. A post of
  your own, or from anyone not on the project's agent list, gets none. A second Reply does not
  stack it; switching the reply to another post swaps or removes the mention Reply put there;
  x on a box holding only that mention empties it. The "Add @name to ask them directly" hint is gone.
- render-room-reply-3745.js asserts all of that through pjReplyStart (the click's own function).

## Where the bar is
rxnsInner has three callers, all project rooms and DMs. The assistant chat draws no hover bar, so
#4358's third surface needs no change there. DMs get the new order and arrow; #4359's mention is
rooms only (a DM is already one agent), per the card.

## Decisions
- "Far right" read as last in the floating bar (the bar is a pill that floats over the message),
  not pushed to the message's right edge.
- An SVG arrow, not an emoji, so it takes the button's colour and matches the app's icons.
- The keyboard focus ring stays the bar's 2px ink ring; only hover and focus border go gold.

- Cursor: after the mention, unless the box was unchanged and the cursor is already in the person's
  own words (a repeat Reply); with no mention it stays on the same letter.
- Only a mention Reply WROTE is Reply's to remove (on x, or on a Reply to another post). A mention
  the person typed is theirs and is never taken out.
- A box holding only Reply's mention has no words yet: Enter says "Say something first.", and an
  attach-only send puts the file names after the mention.
- The screen reader hears that the mention is in the box and how to reply to the room instead.
- Because the mention goes through the input event, it is saved as the room's draft like typing,
  so a Reply left open counts as unsent words for the update auto-reload guard. That is on purpose:
  the box is not empty.
- The .pj-replying-h CSS rule stays: render-no-left-bars-3692 renders synthetic markup with it.

## Weakest premise
The "far right" reading. If Josh meant the right edge of the message, it is one CSS line.
