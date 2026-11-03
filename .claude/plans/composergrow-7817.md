# composergrow-7817: the conversation stays put while the message box grows

Card: kosmos#7817 (Josh 18:28 11-02, iPhone, typing a long message in a DM: every wrap of the box moved the conversation).

## Finished looks like
At the newest message, as the box grows a line at a time and shrinks again, the newest message stays the same distance
above the box (within 4 pt). A reader higher up is not moved by it.

## Measured
- Josh's screenshots (private): over three extra lines the box grew about 140 pt and the messages moved about 255 pt the
  other way (older messages into view).
- New UI test on the iPhone 17e simulator, main's code: after one line the gap above the box went from 90 to 46 pt
  (the box grew, the list did not follow). After the fix: passes, 5 lines up and two pieces deleted.
- Josh's 18:50 #7420 diagnostic (posted on the card by Splinter): with the keyboard up, the viewport and the content
  height changed under the list between tries. Same family: the list's end is not re-placed as its viewport changes.

## Change
- ChatView: `stripHeight`, the height of the strip under the list (the box and its line), read by a GeometryReader on
  the strip. When it changes and the reader is at the newest message (`atBottom`, not searching, no finger on the
  list), the list is put at its end, as keyboardDidShow already does. Not on the strip's first measure (0 to its
  height as the chat opens).
- ios/tools/ui-sample.sh: KeyboardSlideUITests count 9; ui-keyboard.sh's stale count 3 raised to 9.

## Rejected
- Scrolling on every draftText change: a wrap is what moves the list, not a letter.
- Animating the follow: the side lock (#7574) relies on the anchor move being unanimated.
- Treating an anchor still on "end" as at the newest (round 1's idea for a fast paste): a stale "end" survives for a
  reader the keyboard hold put back higher up, who would then be pulled down (round 2).

## Weakest premise
`atBottom` must still be true after the box has covered the end marker. It clears only under a person's scroll
(ChatView end-disappear), which the test's pass supports but a device may differ (Josh's phone moved the list the
other way, which the simulator did not reproduce). On iOS 16 and 17 (followsScrollPhase off) a paste of several lines
can hide the end marker and clear atBottom before the follow runs; residual, not tested (the simulator runs iOS 26).
Also residual: in KeyboardHold's window right after the keyboard shows, an iOS jump can briefly show the end marker for
a reader higher up (atBottom true until the hold's re-read 0.1 s later); a strip change in that window (the emoji
panel closing on focus) would take them to the newest. Not reproduced or tested.
Josh's phone moved the list the other way (older messages into view); the simulator shows only the list not
following. Not proven fixed for his symptom until seen on a TestFlight build.

## Tests
- KosmosUITests/KeyboardSlideUITests.testNewestStaysJustAboveTheBoxAsItGrowsAndShrinks: fails on main (90 to 46 pt
  after one line), passes with the fix (five pieces of 54 characters typed, four deleted); the shrink arm asserts the
  box lost a line.
- testReadHigherUpStaysWhileTheBoxGrows: a reader 40 rows up stays within 4 pt while the box grows three pieces; a guard
  (passes on main too).
- Run by ios/tools/ui-keyboard.sh and CI's ui-sample job.
