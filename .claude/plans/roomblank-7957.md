# #7957: tell a moment from a blank room

Addresses #7957.

## What finished looks like
The next time testRoomNewestStaysAboveTheBox loses its post on CI, the failure says whether the room was still blank 3 s later, and a local run keeps a screenshot.

## Measured
- CI: "Post 220 was gone after the keyboard came up; on screen:" with no post listed, on main and on branches, and a trace ending "settle gave up".
- Here, 11-04: the test alone on iOS 26.5, 15 of 15 passed. It did not reproduce away from the long class on a busy runner.
- CI keeps no screenshot of this job (the run has no artifacts).

## Change
Test only. On a lost post, RoomKeyboardUITests.still looks again after 3 s, says what it found (or "BLANK, no post at all") and attaches a screenshot. A passing run is untouched: it returns before any of this.

## Decided
- No recovery yet. Rejected building one now: a room blank is still a reading of one empty listing plus a trace line, and a rebuild moves the reader, so it needs evidence first. Weakest premise: waiting costs a real blank staying in rooms until the next red, about one in 13 CI runs going by the last 40. Nobody has reported it on a phone.
- What would change it: "BLANK, no post at all" in a CI failure means build the recovery; posts back after 3 s means the test should wait for the move to end.

## Tests
Control: with the test temporarily asked for a post that does not exist, it failed with the second look in its message and the screenshot "room-post-220-gone" in the result bundle. Restored afterward. The 15 repeats ran with this change compiled in.
