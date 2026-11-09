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

## Review rounds (blind, read-only reviewers)

Round 1 (11:0x):
- MAJOR the dots' show/hide re-evaluated the whole chat mid-pull --> FIXED: WorkingStrip is its own view observing EndPullDriver.dotsUp (published a turn later); the chat holds the driver in @State without observing it.
- MAJOR the line drew over message text when scrolled up --> FIXED: a ground behind the line fading in from 6 pt above it; ChatGapUITests.testTheWorkingLineShowsToAReaderHigherUp (screenshot reviewed).
- MINOR line over the "New messages" capsule at large text --> FIXED: capsule bottom padding is endRoom.
- MINOR no positive control around the hide --> FIXED: the line is asserted before the pull and after the dots go.
- MINOR dots measured from the words, not the bubble --> FIXED (bubble, time line included).
- MINOR source pin lost the still dots --> FIXED (animated: false pinned).
- MINOR first frame at large text uses 16 --> ACCEPTED: the end row grows once after the chat opens at accessibility sizes; the UIKit list puts the reader back at its end after each layout. Weakest premise above.
- NIT retain cycle --> gone with the callback. NIT ChatList comment overclaimed --> reworded.
- UIKit onChange(of: working) raising "New messages" --> removed.

Round 2 (12:3x):
- MAJOR the lazy list still followed on `working` (a capsule with no new message, or an animated scroll) --> FIXED: removed, pinned absent on both lists.
- MINOR dots clearance 2.5 pt vs a 2 pt floor --> floor 1 pt, with the measurement in the comment. The room is 45 pt for 24 pt dots and both clearances; no rest gives both more.
- MINOR source pin missed the capsule and the onChange --> FIXED.
- MINOR end room grows after open at AX sizes --> ACCEPTED as in round 1.
- NIT workingStrip --> WorkingStrip.

## Pre-existing, not this card (A/B on this Mac, main fd6d160a09 vs this branch)
- EndPullUITests lazy, 3 iterations: main 6 of 18 failed, branch 18 of 18 passed (noted on #8072).
- NewMessagesUITests.testAReaderWhoDraggedUpKeepsTheirPlaceAsRowsLeaveTheTop: main 3 of 3 failed, branch 1 of 3 (a by-hand class, not in CI).
