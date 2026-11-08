# kosmos#8221 slice 3: a reader higher up keeps their exact place on the UIKit list

On main after slice 2 (#8243, merged 11-08 08:33 CST as eaf8b96e0c). Debug only: a release build still draws the lazy list.

## Finished looks like
On the UIKit list, a reader the person moved higher up stays exactly where they were (the highest row on screen at the
same height, within 4 pt) as rows land and drop off above it, as the keyboard comes up, and as the message box grows. The
two KeyboardSlideUITests checks that skipped themselves on the UIKit arm run there and pass; new KOSMOS_SAMPLE_GROW checks
do the rows-come-and-go case on both lists. The check that the change makes pass is shown red on a build without it; a
check that passes either way is labelled a regression guard, not evidence for the change.

## What changed
- ChatList.Coordinator: `place`, the highest row on screen and its distance below the top of the list.
  - Dropped on any move that is not the list's own (its pin, its hold, a layout pass, an update being applied): the
    person's scroll, a scroll by code, a scroll iOS makes itself (VoiceOver's page scroll). Taken again when a scroll ends
    and on the next layout that finds none. Also dropped whenever the reader is at the newest.
  - A status-bar tap is handled like the end of any scroll, but not checked: the composer is a scroll view too, and
    whether iOS sends the tap to this list was not measured.
  - Held in `laidOut()`: after every layout that is not under the person's finger or fling AND finds the list not moving,
    the held row is put back at its distance, clamped to the list's range. Moving: within 0.25 s of an offset change that
    is not the list's own, until a scroll reports its end. While moving, no place is taken (here or in `apply()`) and none
    is held, because a hold sets the offset and would end an animated scroll there (seen once: 228 of 300 pt in a full
    NewMessages run). Review iterations 3 to 7 went through two weaker forms of this rule (same offset two layouts
    running), which a busy chat's updates inside an animation could still defeat. A hold that lands
    within endSlack of the end makes the reader at the newest. The at-the-newest pin is unchanged and still wins when atEnd.
  - In `apply()`: when there is no place, or the held row is about to be removed (the window sliding,
    KOSMOS_SAMPLE_NOKEEP), the next row on screen that stays is taken from the rows as drawn before the change.
- KeyboardSlideUITests: testReadHigherUpStaysWhereItWas and testReadHigherUpStaysWhileTheBoxGrows no longer skip on the
  UIKit arm.
- NewMessagesUITests, both on GROW (every read slides the window by one), the top row read every second for 15 s, the
  capsule showing as the control that arrivals came in that time:
  - testAReaderHigherUpKeepsTheirPlaceAsRowsComeAndGo: as the app runs. carryDropped (#7265) keeps the slid-out rows on
    the phone, so no row leaves above the reader; a regression guard.
  - testAReaderHigherUpKeepsTheirPlaceAsRowsLeaveTheTop: the same with KOSMOS_SAMPLE_NOKEEP=1 (carryDropped off), so every
    read takes the oldest row off the top. The check for this slice.
  - testAScrollWithNoFingerMovesAReaderHigherUpAsRowsLeaveTheTop: the SCROLLBY check under NOKEEP, so updates land
    around the scroll. Whether one lands inside the animation is chance; it does not force that case.
  - testAReaderWhoDraggedUpKeepsTheirPlaceAsRowsLeaveTheTop: the same, the reader moved up by a real drag, so the place is
    taken at the end of the person's own scroll (review iteration 5: the rest reference was stale after a drag).

- KOSMOS_SAMPLE_SCROLLBY=<pt> (Debug, in ChatList's scroll-up hook): an animated scroll that far up, 5 s after the
  scroll-up. NewMessagesUITests.testAScrollWithNoFingerMovesAReaderHigherUpAndStays: the reader moves about that far and
  is not put back (review iteration 1 found the first version of the hold undid such scrolls).

## Rejected
- Holding by content-size difference (offset += new height minus old height). Wrong when rows change below the reader
  too (an arrival at the end adds height below, not above), so it needs the row anyway.
- UICollectionView's own position keeping: it has none for a diffable apply without animation (the offset stays, so the
  rows slide).

## Weakest premise
Telling the list's own moves from scrolls by which call changed the offset (pin, hold, layout pass, update). An offset
change UIKit makes outside those (an inset change, say) drops the place, and the reader is then followed rather than held;
the keyboard and box checks pass with this code, so it does not move a reader there, but nothing shows whether the place
was dropped and taken again or kept.

Also: that the row the person reads is the highest row with any part on screen. A tall row cut off at the top is held by its top
edge, which is right for keeping the pixels still but would not be if a later change asked to keep the middle row.

## Measured (iPhone 17 Pro Max simulator, iOS 26.5, 11-08, by hand; nothing runs the UIKit arm in CI)
| check | UIKit, with slice 3 | UIKit, without (slice 2's ChatList.swift) | lazy |
|---|---|---|---|
| rows leave the top (NOKEEP) | **pass 9 of 10** (1 lost to the check's own query, fixed, then 4 of 4) | **red 3 of 3**: "after 4 s: 'Message 225 of 260.' left the screen"; "after 4 s: moved from 206 to 138" (one row); "after 4 s: 'Message 224 of 260.' left the screen" (frame-based version) | pass 1 of 1 |
| scroll with no finger (SCROLLBY), UIKit only | pass 7 of 8 (the miss: 228 of 300 pt in a full class run, the hold stopping the scroll; fixed, then 3 of 3 alone and in 2 of 2 class runs on the final code) | **red 2 of 2** on the hold before review iteration 1: "moved 0 pt, not about 300" | skips (no SCROLLBY hook) |
| SCROLLBY while rows leave the top (NOKEEP), UIKit only | pass 3 of 3 (final code) | not run without the change (it reaches the same fix as the row above) | skips |
| reader who dragged up, rows leave the top | pass 2 of 2 (final code) | **pass 2 of 2** on the iteration 4 code it was added for, so a regression guard for the drag path, not evidence: the stale rest reference it was meant to catch never showed (later layouts held the place anyway), and the final code has no rest reference at all | pass 1 of 1 (in the lazy class run) |
| rows come and go (as the app runs) | pass 1 of 1 | pass 1 of 1 (regression guard) | pass 1 of 1 |
| read higher up, keyboard up | pass 1 of 1 | pass 1 of 1 (regression guard) | pass 1 of 1 |
| read higher up, box grows | pass 1 of 1 | pass 1 of 1 (regression guard) | not run |

Every UIKit-arm chat class with slice 3 (one run each): NewMessages 5, KeyboardSlide 9 (3 skipped: the lazy list's
rebuild), ChatSearch 1, ChatDrag 1, ChatOpensAtNewest 2, SendMovesOnce 3, ComposerSend 3, DotsRefresh 9, StopAdding 2:
35 run, 0 failures. On the final code (after review iteration 7): NewMessages 8 of 8 twice and KeyboardSlide 9 (3
skipped) on the UIKit list; NewMessages on the lazy list 8 (2 skipped: the SCROLLBY checks), 0 failures.

The one lost run: picking the top row asked every row isHittable, and a row leaving the list that moment failed the check
itself ("Activation point invalid"). The pick and the on-screen test are now by frame.

Why the two keyboard checks pass without the change on the UIKit list: the keyboard and the box take room from the bottom
of the list, and a UICollectionView keeps its offset, so the top row does not move. They guard against a later change that
moves it. Two earlier no-fix attempts were discarded: one runner never launched (simulator busy right after install), and
one build was killed (rc 137, empty log, cause not found), so its tests ran the previous build with the fix.

Also seen: the #7420 TestFlight 57 diagnostic (11-08 07:51) shows the lazy list parked about 1,000 pt past its last row,
which is the estimated-height failure this list replaces; written up on #7420.

## Still owed (later slices)
VoiceOver scrolling away from the newest message: a reader at the newest is still pinned back to the end during an
animated scroll with no finger on it (atEnd is read only when the scroll ends). Older than this slice; it belongs to the
accessibility slice (10). A fling under rows leaving the top: the hold waits until the fling ends, so the rows slide during
it. A runner for the UIKit arm; the keystroke cost (trace "uikit list: N updates, M cells drawn again"); RowTop readings
unusable in hosted cells; letting a phone choose the UIKit list.
