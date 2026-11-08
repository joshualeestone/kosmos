# kosmos#8221 slice 3: a reader higher up keeps their exact place on the UIKit list

Stacked on slice 2 (#8243, branch uikitlist-s2-8221, open: blocked only by the shell-shard red of #8244). Retarget to
main once #8243 merges. Debug only: a release build still draws the lazy list.

## Finished looks like
On the UIKit list, a reader the person moved higher up stays exactly where they were (the highest row on screen at the
same height, within 4 pt) as rows land and drop off above it, as the keyboard comes up, and as the message box grows. The
two KeyboardSlideUITests checks that skipped themselves on the UIKit arm run there and pass; new KOSMOS_SAMPLE_GROW checks
do the rows-come-and-go case on both lists. The check that the change makes pass is shown red on a build without it; a
check that passes either way is labelled a regression guard, not evidence for the change.

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
- NewMessagesUITests, both on GROW (every read slides the window by one), the top row read every second for 15 s, the
  capsule showing as the control that arrivals came in that time:
  - testAReaderHigherUpKeepsTheirPlaceAsRowsComeAndGo: as the app runs. carryDropped (#7265) keeps the slid-out rows on
    the phone, so no row leaves above the reader; a regression guard.
  - testAReaderHigherUpKeepsTheirPlaceAsRowsLeaveTheTop: the same with KOSMOS_SAMPLE_NOKEEP=1 (carryDropped off), so every
    read takes the oldest row off the top. The check for this slice.

## Rejected
- Holding by content-size difference (offset += new height minus old height). Wrong when rows change below the reader
  too (an arrival at the end adds height below, not above), so it needs the row anyway.
- UICollectionView's own position keeping: it has none for a diffable apply without animation (the offset stays, so the
  rows slide).

## Weakest premise
That the row the person reads is the highest row with any part on screen. A tall row cut off at the top is held by its top
edge, which is right for keeping the pixels still but would not be if a later change asked to keep the middle row.

## Measured (iPhone 17 Pro Max simulator, iOS 26.5, 11-08, by hand; nothing runs the UIKit arm in CI)
| check | UIKit, with slice 3 | UIKit, without (slice 2's ChatList.swift) | lazy |
|---|---|---|---|
| rows leave the top (NOKEEP) | **pass 9 of 10** (1 lost to the check's own query, fixed, then 4 of 4) | **red 3 of 3**: "after 4 s: 'Message 225 of 260.' left the screen"; "after 4 s: moved from 206 to 138" (one row); "after 4 s: 'Message 224 of 260.' left the screen" (frame-based version) | pass 1 of 1 |
| rows come and go (as the app runs) | pass 1 of 1 | pass 1 of 1 (regression guard) | pass 1 of 1 |
| read higher up, keyboard up | pass 1 of 1 | pass 1 of 1 (regression guard) | pass 1 of 1 |
| read higher up, box grows | pass 1 of 1 | pass 1 of 1 (regression guard) | not run |

Every UIKit-arm chat class with slice 3 (one run each): NewMessages 5, KeyboardSlide 9 (3 skipped: the lazy list's
rebuild), ChatSearch 1, ChatDrag 1, ChatOpensAtNewest 2, SendMovesOnce 3, ComposerSend 3, DotsRefresh 9, StopAdding 2:
35 run, 0 failures.

The one lost run: picking the top row asked every row isHittable, and a row leaving the list that moment failed the check
itself ("Activation point invalid"). The pick and the on-screen test are now by frame.

Why the two keyboard checks pass without the change on the UIKit list: the keyboard and the box take room from the bottom
of the list, and a UICollectionView keeps its offset, so the top row does not move. They guard against a later change that
moves it. Two earlier no-fix attempts were discarded: one runner never launched (simulator busy right after install), and
one build was killed (rc 137, empty log, cause not found), so its tests ran the previous build with the fix.

Also seen: the #7420 TestFlight 57 diagnostic (11-08 07:51) shows the lazy list parked about 1,000 pt past its last row,
which is the estimated-height failure this list replaces; written up on #7420.

## Still owed (later slices)
A runner for the UIKit arm; the keystroke cost (trace "uikit list: N updates, M cells drawn again"); RowTop readings
unusable in hosted cells; letting a phone choose the UIKit list.
