# sheet-7419: the long-press sheet (kosmos#7419)

Josh, 2026-10-27 20:24: long-press a message for a Discord-style bottom sheet. Mona Lisa's design on the card (20:28,
mocks ~/work/design-shots/kosmos-7419/). Stacked on diag-7420.

## Finished looks like
- Long-press a message in a direct message or a project room (a light haptic) opens a bottom sheet with a grab handle,
  sized to its content: a row of seven quick reactions (👍 ❤️ 🔥 😂 👀 ✅ 🎉) and More, then Reply and Copy text.
- A reaction already the person's has a warm fill and a 2 pt gold ring; tapping it takes it off. Tapping any reaction
  reacts and closes the sheet.
- More grows the sheet to full height: "Reactions" with Done, the board's 80 (PJ_EMOJI), eight to a row, in its order.
- Messages that take no reaction or reply (the person's own, an outside room message) show only Copy text.
- VoiceOver: "React with 👍" / "Remove 👍", "More reactions". The bubbles' VoiceOver actions are unchanged.
- The long press is a simultaneous gesture, so taps on links and the scroll still work. Pending messages keep their
  own menu (Delete).

## Decisions
- The message is not lit above the dim (the design's "stays lit"): a SwiftUI sheet dims the whole screen and drawing a
  copy of the bubble above it is a separate, larger change. Weakest premise: Mona Lisa may want it; it can follow.
- One shared view (MessageActionsSheet, in ComposerExtras.swift) for the chat bubble, the files bubble and the room's
  post, so the three cannot drift.

## Verify
- iOS 16 typecheck (release and DEBUG); all nine LogicTests scripts (room: the seven, each in the board's 80, the
  three long-press sites, no reaction menu left, More's grid, Copy takes the row's words).
- Simulator shots via KOSMOS_SAMPLE_SHEET=1 / =more (light and dark).

## Review
- Round 1 (opus): 1 probable blocker fixed: a simultaneous long press let the lifted finger also tap a file card, reply
  header or link inside the bubble; now a high-priority half-second press (a short tap still reaches them, a scroll
  still wins). Warnings fixed: one sheet per chat and per room (MessageActionsHost, through the environment) instead of
  one per row; More resizes through a chosen detent on iOS 16; Done only closes; Reply runs from the sheet's onDismiss;
  the reaction row shrinks to fit a 320 pt screen. Nits fixed: Copy text copies the words shown (none for a files-only
  message, which hides it); icons hidden from VoiceOver; your own reactions carry the selected trait; More's grid is
  bare emoji with your own in a gold-ringed rounded square, as the mock. Still owed on a device: a long press on a
  file card, a link and a reply header (the gesture cannot be driven on the simulator).
- Round 2 (sonnet): no blocker; 2 warnings fixed: the room's Copy text copies the words shown (Board.roomWords), as the chat does; VoiceOver opens the sheet as a "Message actions" action (a long press is not one). Nit fixed: the host comment. Accepted: a Dynamic Type change while the sheet is open leaves its height until the next open.
- Round 3 (sonnet): 1 warning fixed: in the chat the VoiceOver action was dropped by the bubble's children: .ignore; a second modifier now puts Message actions on the bubble's own element. Nit fixed: the room's VoiceOver Copy also copies the words shown. Round 4 owed.
- Round 4 (sonnet): 1 warning fixed: on a message with files VoiceOver never offered Message actions (the files bubble is a container, whose own actions are never offered); each file card now offers it, through the chat's one sheet. No duplicates found elsewhere. Round 5 owed.
