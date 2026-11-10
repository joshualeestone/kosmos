# chatgap-8283: less empty room above the iPhone chat's message box

Card: joshualeestone/kosmos#8283 (Josh 2026-11-09 07:25, his screenshots: about 72 pt between the newest message and the box,
against Discord's about 34).

## Scope after CI (11-09 evening): the new (UIKit) list only

CI's old-list job failed twice (5 of 56: the 260-message chat did not open at its newest message). Reproduced on this Mac's
iOS 26.5 simulator (CI's runtime): main 0 of 10 failed, this branch 3 of 10; putting back the old list's 28 pt working row
alone cured it (0 of 5). Restoring the old list's follow on `working` did not. So the old list keeps its working row, its end,
its follow and its dots' rest exactly as on main; the gap change, the line over the strip and the new tests apply to the UIKit
list, the one Josh uses ("New chat list" on). The old list is the fallback #8221 replaces. Final: old list on 26.5 10 of 10,
UIKit list on 26.5 9 of 9 (bubble to box 45 pt, the same as on 27).

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

1. ChatView: no working row in the lazy list or the UIKit list's ids. `WorkingStrip` (its own view) draws `WorkingLine` over
   the composer strip, standing on a zero-height frame at the strip's top (4 pt above it), one line, only while `working`, on a
   ground that fades in from 6 pt above it (so a reader higher up sees messages fade out behind it). A hidden copy with still
   dots measures its height; `endRoom = max(fadeHeight + 8, lineHeight + 10)` is the end marker's height on both lists and the
   "New messages" capsule's bottom padding. An alignment guide was tried first and moved nothing (measured: the line sat on the
   box's edge). Neither list reacts to `working` any more (no follow, no capsule).
2. ChatList: bottom contentInset 0 (top stays listPadV). The dots' rest (`restsAbove`) is 11.5 on both lists (was 14.5 lazy,
   2.5 UIKit): at the true end of a long chat, 14.5 put the dots 0.5 pt into the newest message's time line.
3. EndPullDriver: `ObservableObject` with `@Published dotsUp`, true while its dots are on screen at alpha >= 0.25, published a
   turn later. Only WorkingStrip observes it (the chat holds the driver in @State without observing), so the dots coming and
   going never re-evaluates the chat mid-pull.

## Tests

- New ChatGapUITests (either list, in both CI arms, 3 checks): bubble (time line included) to box <= 60 pt; the working line
  >= 2 pt under the bubble and >= 12 pt above the box's words, at the default and the largest text size; and, scrolled up, the
  line is on screen above the box while the newest message is not.
- EndPullUITests long-chat check: the working line shows before the pull, is absent under the dots and back after; the dots
  >= 1 pt under the newest message's bubble and >= 18 pt above the box. The 1 pt floor is tight on purpose: at rest they are
  2.5 pt clear (measured 11-09), so a change to the bubble's time line or padding can turn it red; look here first if it does.
- SendMovesOnceUITests: comments only (the line appearing still moves nothing; that test still runs).
- LogicTests/room: the #7348 pin on the hidden kept row is replaced by a #8283 pin (WorkingStrip, the still measuring copy,
  endRoom on both lists and the capsule, no `onChange(of: working)`, and the driver's dotsUp wiring).

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
