# kosmos#8221 slice 3: a reader higher up keeps their exact place on the UIKit list

Stacked on slice 2 (#8243, branch uikitlist-s2-8221, open: blocked only by the shell-shard red of #8244). Retarget to
main once #8243 merges. Debug only: a release build still draws the lazy list.

## Finished looks like
On the UIKit list, a reader the person moved higher up stays exactly where they were (the highest row on screen at the
same height, within 4 pt) as rows land and drop off above it, as the keyboard comes up, and as the message box grows. The
two KeyboardSlideUITests checks that skipped themselves on the UIKit arm run there and pass; a new KOSMOS_SAMPLE_GROW check
does the rows-come-and-go case on both lists. Each UIKit result is shown able to fail by building without the change.

## What changed
- ChatList.Coordinator: `place`, the highest row on screen and its distance below the top of the list.
  - Taken when the person's scroll ends (drag, fling, status-bar tap), and on the first layout after a scroll by code
    (the KOSMOS_SAMPLE_SCROLLUP hook clears it). Cleared while the person scrolls and whenever the reader is at the newest.
  - Held in `laidOut()`: after every layout that is not under the person's finger or fling, the held row is put back at its
    distance, clamped to the list's range. The at-the-newest pin is unchanged and still wins when atEnd.
  - In `apply()`: when the held row is about to be removed (the window sliding, KOSMOS_SAMPLE_GROW), the next row on screen
    that stays is taken from the rows as drawn before the change.
- KeyboardSlideUITests: testReadHigherUpStaysWhereItWas and testReadHigherUpStaysWhileTheBoxGrows no longer skip on the
  UIKit arm.
- NewMessagesUITests: testAReaderHigherUpKeepsTheirPlaceAsRowsComeAndGo (GROW: every read drops the oldest and adds one).
  Its top row is read every second for 15 s; the capsule showing is the control that arrivals came in that time.

## Rejected
- Holding by content-size difference (offset += new height minus old height). Wrong when rows change below the reader
  too (an arrival at the end adds height below, not above), so it needs the row anyway.
- UICollectionView's own position keeping: it has none for a diffable apply without animation (the offset stays, so the
  rows slide).

## Weakest premise
That the row the person reads is the highest row with any part on screen. A tall row cut off at the top is held by its top
edge, which is right for keeping the pixels still but would not be if a later change asked to keep the middle row.

## Measured
(filled from the runs below)

## Still owed (later slices)
A runner for the UIKit arm; the keystroke cost (trace "uikit list: N updates, M cells drawn again"); RowTop readings
unusable in hosted cells; letting a phone choose the UIKit list.
