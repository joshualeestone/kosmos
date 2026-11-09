# chatgap-8283: less empty room above the iPhone chat's message box

Card: joshualeestone/kosmos#8283 (Josh 2026-11-09 07:25, his screenshots: about 72 pt between the newest message and the box,
against Discord's about 34).

## Finished looks like

With the keyboard up, the room between the newest message (its time line included) and the box's visible edge is about
Discord's 34 pt on both chat lists (lazy and UIKit), measured on the simulator; the "is working" line still shows, clear of the
newest message and of the box, and its coming and going moves nothing; the pull past the end (#8072) still shows its dots
clear of both.

## Where the room came from (measured, iPhone 17e simulator, iOS 27, keyboard up, Dana's sample chat)

- The working line's row, kept at full height while idle (#7348): 12 pt padding + a 16 pt line.
- The end marker: the box's 18 pt fade + 8 pt (#7346). Kept.
- The list's bottom padding (listPadV, 12 pt). On the UIKit list this was a contentInset ON TOP of the same end room, so the
  UIKit list rested 12 pt higher (102 vs 90 pt from the newest message's words to the box).

## Change

1. ChatView: no working row in the lazy list or the UIKit list's ids. `workingStrip` draws `WorkingLine` over the composer
   strip, standing on a zero-height frame at the strip's top (4 pt above it), only while `working`. An alignment guide was
   tried first and moved nothing (measured: the line sat on the box's edge).
2. ChatList: bottom contentInset 0 (top stays listPadV). The UIKit dots' rest goes back to the lazy list's 14.5 (slice 9 had
   set 2.5 for the extra room).
3. EndPullDriver: `drawn(Bool)` callback when its dots go on and off screen; the chat hides the working line while they show,
   because they rest in the same room, centred, and a long name would reach them.

## Tests

- New ChatGapUITests (either list): bubble to box <= 60 pt; the working line >= 2 pt under the bubble and >= 12 pt above the
  box's words.
- EndPullUITests long-chat check: the working line is absent under the dots; the dots >= 14 pt under the newest message's
  words and >= 18 pt above the box.
- SendMovesOnceUITests: comments only (the line appearing still moves nothing; that test still runs).
- LogicTests/room: the #7348 pin on the hidden kept row is replaced by a #8283 pin (line drawn over the strip, no row).

## Numbers

| | before | after |
|---|---|---|
| words to box, lazy | 90 | 62 |
| words to box, UIKit | 102 | 62 |
| bubble (with time) to box's words, both | | 45 |
| time line to box's visible edge (screenshot) | ~72 by Josh's reading | ~34 |

## Weakest premise

The overlaid line's place is tuned to the footnote size; at the largest text sizes the line grows taller and could reach the
newest message's time line. The room above it (about 6 pt at default size) is the margin.

## Rejected

- Shrinking the paddings and keeping the reserved row: saves at most 15 pt and puts the newest message into the fade.
- Collapsing the row while idle: brings back #7348's 27 pt jump when an agent picks up a message.
