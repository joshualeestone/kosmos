# longpress-7678: with the keyboard up, a long press opens the message's actions without lowering it or moving the chat

Card: kosmos#7678 (Josh 10-31 08:37, TestFlight 24): "When the keyboard is up and I long press it jumps the message down
and auto hides the keyboard which is weird". Design on the card (comment 6546026720, which corrects 6545965327).

## Finished looks like
- In a DM and in a room, with the keyboard up, a long press on a message shows its actions in a panel inside the chat,
  next to the pressed message, over the same dim with the pressed bubble lit. The keyboard stays up and the pressed row
  does not move (within a point). Closing the panel (a tap on the dim, or an action) leaves both as they were.
- The panel has what the sheet's small height has: the quick reactions, Reply, Copy text, Delete (own messages, asks first).
  More (the whole emoji list) lowers the keyboard and opens the sheet at full height, as today: it needs the room.
- With the keyboard down, or with VoiceOver on, the sheet as today (#7419, #7530 unchanged).
- A UI check (DM): keyboard up, long press a message mid-list: keyboard still there, the row within 1 pt, Reply shows; a tap
  on the dim closes it with both unchanged. Control: the same press with the keyboard down opens the sheet (Reply shows).
  Run on iOS 27 and 26.5. Then needs-device for Josh.

## How
- MessageActionsHost tracks whether the keyboard is up (keyboardWillShow / WillHide). openMessageActions: keyboard up and
  VoiceOver off -> `panel = t` (no resignFirstResponder, no sheet); otherwise today's path.
- The panel is drawn in the host's existing overlayPreferenceValue(PressedBubbleKey), in the same GeometryReader as LitDim, so
  it resolves the bubble and the visible area (above the composer, so above the keyboard) in one coordinate space. Placed
  above the bubble if it fits inside the visible area, else below it, else pinned to the visible area's bottom. An overlay
  takes no layout, so nothing in the chat moves.
- The panel's contents are MessageActionsSheet's actions, given a close and a More in place of the sheet's dismiss and
  detent (one source for the rows, so the panel and the sheet cannot drift).

## After review round 1
- The panel may reach down to the keyboard's top, over the composer: at the composer's limit most positions on a phone fitted neither side.
  Neither side fits: the side with more room, which can cover part of the message. Accepted.
- It falls back to the sheet (keyboard lowered, as today) with Switch Control, at an accessibility text size, or where it cannot fit
  (landscape). VoiceOver as before. So in those cases the original jump remains.
- The Delete question lowers the keyboard (measured) and it comes back after Keep it, so that path does jump. Accepted: the question
  is a system alert. "Leaves both as they were" holds for closing the panel and for its other actions.
- Not fixed: the panel lives on keyboard notifications (a chat or Mac switch does not close it), as the sheet's target does.

## Not in scope
- iOS 17 and 18: no simulator runtime on this Mac. Named as unmeasured.
- The Delete question is a system alert; whether presenting it lowers the keyboard is measured, not designed around.

## Decided
- In-chat panel, not the sheet with the keyboard up (it sits behind the keyboard, #7530) and not lower-then-raise (the jump
  happens twice).
- Weakest premise: that the panel stays above the keyboard and readable when the pressed message is near the bottom of
  a short visible area (a small phone, a large text size). Measured on two simulators at the default text size only.
