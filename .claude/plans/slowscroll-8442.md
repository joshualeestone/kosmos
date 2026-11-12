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

Second (review 2): a lapse check that runs more than personScrollStallLate (0.1 s) after it was due ran after a stall,
and the moves it held back may come after it: an animated scroll's frames are driven by the display, not this queue.
Such a check waits one more quiet period for them, once a window (not every time, so an app stalling over and over cannot
keep a reader at the newest unfollowed). Either fix alone keeps the stepped stalled scroll (measured: the grace alone gave
pins 1, moved 373); the control turns both off.

Rejected: reopening a window for a move that comes soon after one closed (the pin at the close has already undone the
scroll by then); a longer personScrollQuiet (moves the threshold, not the race).

Weakest premise: that a non-person move (an inset change, the keyboard) landing in that short gap between personUntil
and the lapse check is harmless when read as the person's. It could only happen within a few frames of a fingerless
scroll's last move (the lapse check's 0.05 s margin plus however late its timer fires, so it grows with load), and it
would leave the reader where the list moved them rather than pinning. The same sequence was already possible inside the
0.3 s window itself, so this widens an existing exposure rather than adding one. A new message landing in the gap is
the list's own write (apply), so it does not read the reader off the end: laidOut leaves the list alone while the window
is open and the lapse check pins them when it closes it (review 1, read from the code). How late, from the code (review
3): with the last move at t0, the window closes at t0 + 0.35 + L1 without the grace, and at t0 + 0.35 + L1 + 0.35 + L2
with it, L1 and L2 being how late each check ran (the grace needs L1 over 0.1 s). The grace's test is "ran more than
0.1 s late", not "the main thread stalled": any main-thread work over about 65 ms when the check is due trips it, so
it will fire in ordinary use on a busy phone, holding the window about 0.35 s longer, once a window. Would change my mind:
a check where a new message arrives in that gap and the reader at the newest is not followed.

## Change

- ios/Kosmos/ChatList.swift: fingerlessScrolling() is `personUntil > 0`; personScrollLapsed reads the clock; debug only:
  a "stalled" mode of KOSMOS_SAMPLE_A11YSCROLL (0.6 s held before the second move, a 4 s watch) and
  KOSMOS_SAMPLE_WINDOWBYCLOCK=1 (the window as before, the control arm); personScrollStallLate and the once-a-window stall
  grace in personScrollLapsed (lapseCheck carries the time it is due), with KOSMOS_SAMPLE_NOSTALLGRACE=1 for its control;
  a "stalledAnimated" mode (the animated scroll, the main thread held 0.6 s 0.08 s into it).
- ios/KosmosUITests/A11yScrollUITests.swift: testASlowScrollWithAStallIsStillFollowed and its control
  testWithTheWindowByTheClockAStalledScrollIsPutBackAtTheEnd (both fixes off); testAnAnimatedScrollWithAStallIsNotPutBack
  and its recorded control testWithoutTheStallGraceAnAnimatedStalledScroll.

## Results

- The app typechecks plain and with -D DEBUG; the UI test files typecheck.
- On a simulator (iPhone 17e, iOS 27.0, the UIKit list, each test once, no retries): A11yScrollUITests and
  A11yFocusUITests, 23 of 23 passed. Stalled with the fix: pins 0, moved 387, at end false. The control: pins 13,
  moved 0, at end true. The existing stepped, animated, jump and still scrolls and every focus check unchanged.

## Challenge loop

- Iteration 1 (opus): no finding at WARNING or above. Confirmed from the code: personUntil goes above 0 only in
  personScrollOpened, which always schedules a lapse check; that check re-arms only while moves are recent and closes
  within about 0.35 s of the last; every other close sets 0. The control is exactly the pre-change code. NITs: the gap
  grows with load (now said under the weakest premise); a focus or a finger's end landing in the gap behaves as it did
  inside the window before; both test arms assume GCD runs overdue main-queue timers in deadline order after the stall
  (true today, not stated by the test).
- Iteration 2 (sonnet): 1 WARNING FIXED: after a stall, a real (animated) scroll's frames are driven by the display and
  need not run before the overdue lapse check, which would then close the window and undo the scroll; the stepped test
  could not see that, its moves being on the same queue. Fixed by the once-a-window stall grace (above), with an
  animated stalled scroll check. Measured on the simulator: that scroll was kept with and without the grace (pins 0,
  moved 408; its end was reported and closed the window as the person's), so the grace is not shown to be needed here:
  it is for a phone or runner where the frames come later, and its control is recorded, not asserted. WARNING 2 (the
  gap grows with load) was already stated under the weakest premise. NITs: comments on the test bounds and on why the
  stall lands where intended.
- Simulator (iPhone 17e, iOS 27.0, UIKit list, once each): A11yFocusUITests 14 of 14 and A11yScrollUITests 10 of 10 on
  6b614aed54 (only the old control failed, as the grace alone kept its scroll); then A11yScrollUITests 11 of 11 on the
  corrected control: stalled pins 0, moved 387; control (both off) pins 12, moved 0.
- Iteration 3 (opus): no BLOCKER; the lapse logic confirmed correct (due computed with its deadline on every path; once
  a window holds). 2 WARNINGs FIXED: no check showed the grace ever ran (the stalled check's moves beat the late check, and
  the animated one was kept by its reported end), so the report now says "graced" and testTheStallGraceAloneKeepsAStalledScroll
  runs with the window read by the clock, where only the grace can keep the scroll, and asserts it fired; and this plan's
  "about 50 ms" is replaced by the bound above. The animated check's comment now says what was measured. NITs: the animated
  stall assumes the window opened before 0.08 s (the report says only that it opened); personScrollStallLate is release
  code, as it must be.
- Simulator after iteration 3 (iPhone 17e, iOS 27.0, UIKit list, once each): A11yScrollUITests 12 of 12. Stalled, both
  fixes: pins 0, moved 387, graced false. The grace alone (window by the clock): graced true, pins 1, moved 373. Both off:
  pins 14, moved 0. The animated stalled scroll: pins 0, moved 408, graced false, with and without the grace.
