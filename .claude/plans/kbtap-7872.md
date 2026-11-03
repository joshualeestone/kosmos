# kbtap-7872: a missed tap is not a hardware keyboard

Card: joshualeestone/kosmos#7872, my half (2). Angel has (1), the two "left the screen" reds, via #7645 (CI is iPhone
17e on iOS 26.5; run ids posted to her).

## Why
Run 41704447200 attempt 1 (#7870, no room code): RoomKeyboardUITests.testRoomReadHigherUpStaysWhereItWas failed on
KeyboardSlideUITests.keyboardUp's "no on-screen keyboard (is a hardware keyboard connected?)". ui-sample.sh already
refuses a run with the Simulator's hardware keyboard on, and 26 of the 27 tests (several of which bring the keyboard
up the same way) passed in that same run, so the keyboard setting was not on: the one tap did not focus the box.

## The call (after review round 1)
keyboardUp waits 20 s for the keyboard (was 10 s). If it still is not up, it attaches a screenshot and fails with the
box's public state (isHittable, frame), so the next red tells a missed tap from a connected or hidden keyboard.
Rejected, from round 1:
- a second tap: one landing while the box slides up moves what the "stays where it was" tests measure, or opens a
  message's actions in the long-press tests;
- reading hasKeyboardFocus: a private key, and value(forKey:) on an unknown key raises, which would crash every UI test;
- forcing ConnectHardwareKeyboard per device (the global check already holds, and the other tests in that run brought
  the keyboard up); marking the tests flaky (it would hide Angel's real #7645 reds).

## Weakest premise
That the red was a slow keyboard or a missed tap, not inferred further: the run left no evidence that tells them apart, which is why the failure now carries a screenshot and the box's state. If the box had focus and still no keyboard came up, the new message says so and the
next step is the per-device preference.

## Tests
A UI-test helper change only; the sample-board CI job on this PR runs it. Local: swiftc -parse of the file.
