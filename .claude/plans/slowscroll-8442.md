# slowscroll-8442: a slow fingerless scroll survives a stall

Card: joshualeestone/kosmos#8442 (found fixing #8221's CI flakes). Off main.

## Finished looks like

A scroll the person makes without a finger (VoiceOver, Voice Control, a keyboard's scroll keys) that has started moving
keeps going when the app stalls for longer than personScrollQuiet (0.3 s) early in it, instead of being put back at the
newest message; shown by a stalled sample scroll, with a control that reproduces the old failure.

## What was wrong (measured)

main's CI run 42906709675: A11yScrollUITests' slow ("stepped") scroll reported pins 8, moved 0, window true, at end
true, on its try and its retry. On a simulator here, the same scroll with the main thread held 0.6 s after its first
move reproduces it with the window read by the clock: pins 13, moved 0, at end true.

The person's-scroll window was open while `CACurrentMediaTime() < personUntil`. A stall delivers the scroll's next moves
after that time but before the lapse check (personScrollLapsed) runs, so they were not counted as the person's: the
reader 15 pt up was still inside endSlack (40 pt) and so "at the end", the list pinned it back, and every later move was
pinned too.

## Decided

The window is open until personScrollLapsed closes it (`personUntil > 0`). personScrollLapsed itself reads the clock to
decide whether the moves have stopped, and looks again while they have not. Every other close (a reported end, a jump
to the newest, rows landing above, dropped pages) already sets personUntil to 0, so no window can stay open: the lapse
check is always scheduled when a window opens and re-arms only while the clock says the moves are recent.

Rejected: reopening a window for a move that comes soon after one closed (the pin at the close has already undone the
scroll by then); a longer personScrollQuiet (moves the threshold, not the race).

Weakest premise: that a non-person move (an inset change, the keyboard) landing in that short gap between personUntil
and the lapse check is harmless when read as the person's. It could only happen within a few frames of a fingerless
scroll's last move, and it would leave the reader where the list moved them rather than pinning. Would change my mind:
a check where a new message arrives in that gap and the reader at the newest is not followed.

## Change

- ios/Kosmos/ChatList.swift: fingerlessScrolling() is `personUntil > 0`; personScrollLapsed reads the clock; debug only:
  a "stalled" mode of KOSMOS_SAMPLE_A11YSCROLL (0.6 s held before the second move, a 4 s watch) and
  KOSMOS_SAMPLE_WINDOWBYCLOCK=1 (the window as before, the control arm).
- ios/KosmosUITests/A11yScrollUITests.swift: testASlowScrollWithAStallIsStillFollowed and its control
  testWithTheWindowByTheClockAStalledScrollIsPutBackAtTheEnd.

## Results

- The app typechecks plain and with -D DEBUG; the UI test files typecheck.
- On a simulator (iPhone 17e, iOS 27.0, the UIKit list, each test once, no retries): A11yScrollUITests and
  A11yFocusUITests, 23 of 23 passed. Stalled with the fix: pins 0, moved 387, at end false. The control: pins 13,
  moved 0, at end true. The existing stepped, animated, jump and still scrolls and every focus check unchanged.
