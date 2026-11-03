# kbtap-7872: a missed tap is not a hardware keyboard

Card: joshualeestone/kosmos#7872, my half (2). Angel has (1), the two "left the screen" reds, via #7645 (CI is iPhone
17e on iOS 26.5; run ids posted to her).

## Why
Run 41704447200 attempt 1 (#7870, no room code): RoomKeyboardUITests.testRoomReadHigherUpStaysWhereItWas failed on
KeyboardSlideUITests.keyboardUp's "no on-screen keyboard (is a hardware keyboard connected?)". ui-sample.sh already
refuses a run with the Simulator's hardware keyboard on, and 26 of the 27 tests (several of which bring the keyboard
up the same way) passed in that same run, so the keyboard setting was not on: the one tap did not focus the box.

## The call
keyboardUp taps once more if no keyboard is up after 5 s, then waits 10 s as before. The failure message now carries
the box's keyboard focus: false is a tap that did not land, true points at a hardware keyboard or a hidden one.
Rejected: forcing ConnectHardwareKeyboard per device in ui-sample.sh (the global check already holds, and the other
26 tests show the keyboard comes up on this runner); marking the tests flaky (it would hide Angel's real #7645 reds).

## Weakest premise
That the red was a missed tap. If the box had focus and still no keyboard came up, the new message says so and the
next step is the per-device preference.

## Tests
A UI-test helper change only; the sample-board CI job on this PR runs it. Local: swiftc -parse of the file.
