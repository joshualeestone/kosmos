# tallopen-9089: a chat of tall replies opens on its newest message

Card: kosmos#9089. Built by Angel (fix 4571db2412, measured 11-25 21:55); handed to Mona Lisa 11-26 03:04 to take to PR
(review loop, Mortals validation, merge) while Angel works #9002. Not in build 73 (decided: reviewer chats are short).

## Done when

On the iPhone's lazy chat list (iOS 27), a short chat of tall replies (tall20: 20 messages, replies of up to 14
paragraphs) opens with its newest message wholly on screen, the first time and on coming back, as the same chat in
one-liners (short20, the control) already does; the UIKit list still does too. The check runs in CI's sample run, so a
regression turns a PR red.

## Cause (Angel, measured 11-25)

The lazy list's id anchor goes to the end marker over rows whose heights are still estimates. When the tall rows are
measured, the end is pushed below the box: 20 tall messages opened short 3 of 3; the same 20 as one-liners 0 of 3; the
UIKit list 0 of 3.

## The change

- ChatView.landOnNewest (after goNewest on open): at 0.3, 0.8 and 1.6 s, while the end has never shown, the chat is
  still the same one (epoch, listEpoch), visible, not searching, at the bottom, rows are drawn, and nothing is under a
  finger or being moved by the person, it scrolls to the end once more. The first time the end shows, it stops.
  Id-anchor list only (iOS 17+). KOSMOS_SAMPLE_NOOPENLAND=1 (Debug) leaves it out: the control.
- BoardClient DEBUG sample: KOSMOS_SAMPLE_LONG=tall20 (the varied pattern that fails: 0, 1, 3, 8, 2, 14 paragraphs on
  Dana's replies) and short20 (one-liners, the control).
- ChatTallOpenUITests (2): tall20 and short20, first open and second open; the newest drawn within 5 s and wholly
  between the top bar and the box once the list is still. TEST_RUNNER_KOSMOS_NOOPENLAND=1 runs the app without the fix.
- ios/tools/ui-sample.sh (Mona Lisa): ChatTallOpenUITests:2 in the lazy arm, so CI runs it.

## Measured

- Angel, 11-25 21:55: ChatTallOpenUITests x3, iPhone 17, iOS 27, lazy list, with the fix: 6 of 6 passed. Before the fix
  the lazy arm failed 3 of 3. short20 passes either way (it is the control for the sample, not for the fix).
- Pending (Angel's queued run, results on #9089): the lazy arm WITHOUT the fix (TEST_RUNNER_KOSMOS_NOOPENLAND=1) must
  FAIL, or the pass is not shown to come from the fix; and the UIKit arm with the fix.

## Weakest premise

That three looks at 0.3, 0.8 and 1.6 s cover the time tall rows take to measure on a slow phone. They cover the measured
case on a simulator; a slower device or a longer chat may measure later than 1.6 s, and then the open still lands short.
A later look stands down once the person has scrolled since the open (personMoves, iteration 1); on iOS 17 only a
scroll still under a finger or moving is seen, so a fling finished inside the first 1.6 s there can still be pulled back.

#### Iteration 1 (blind review, opus)

- [SHOULD-FIX] taken: a later look could pull a reader back after they scrolled up in the first 1.6 s. While the end
  has never shown, endVisible keeps its starting true (only the end's onDisappear clears it), and a person's resting
  scroll copies it into atBottom, so atBottom could not tell "never moved" from "scrolled up". Now personMoves counts
  the person's own scrolls (on each rest, and when a sample walk starts), and each look stands down if it changed since
  the open. Known limit, written in the code: on iOS 17 PersonScroll reports no rest, so only a scroll still under a
  finger or moving holds a look off there.
- [SHOULD-FIX] (evidence, not code): the control (the lazy arm WITHOUT the fix must fail) has not run yet. Angel's
  queued run does it; the merge waits for it, and for the trace line "open landed short of the end" in a passing run.
- [NIT] not taken: the test's 5 s "drawn" check is weak (exists is true below the box); the frame-band check is the
  real one and can fail. The header's "both chat lists" is true of the test, CI runs the lazy arm only.
All 17 logic suites pass.

#### Iteration 2 (blind review of the whole branch, sonnet)

- [NIT] taken: !endSeen made the looks stand down for good once the end showed even briefly; an end shown then pushed
  down as rows were measured is the same bug. Now !(endSeen && endVisible) (the file's own "end showing now", as at
  listBlank and the excused check), with personMoves still keeping a reader's own scroll.
- [NIT] taken: the test's stillness read (two frames 0.5 s apart) could fall between the 0.8 s and 1.6 s looks: a
  false red. It now waits 2 s after the chat shows, past the last look.
- [SHOULD-FIX] recorded, not code: a VoiceOver focus or accessibility scroll in the first 1.6 s may not report a rest,
  so personMoves may not see it; no lazy-arm accessibility check exists to say. Turning the fix off under VoiceOver
  would give those readers the bug back, so it stays, named here as a known limit.
- [SHOULD-FIX] (evidence): the control and the trace line in a passing run are still Angel's pending run. If the first
  look's own scroll counted as a person's move, the later looks would be dead: the trace in a passing run will show
  which looks fired.
- [NIT] not taken: a look does not check positionId/anchorLetGo (the atBottom guard covers the let-go paths); a return
  from the info page schedules new looks, as goNewest there already goes to the end; the test header's "both lists".
All 17 logic suites pass.

#### Iteration 3 (blind review of the whole branch, opus)

No BLOCKER; no code SHOULD-FIX. Converged on the code.
- [SHOULD-FIX] (evidence): the head has never been run, and personMoves counts every scroll that rests (PersonScroll
  calls rested on any change to idle, animated ones too), so an animation resting during the open would silence the
  later looks. Measured by the three-arm run at the head: lazy WITH the fix must pass, lazy WITHOUT must fail, UIKit
  passes. Merge waits for it.
- [NIT] taken: personMoves' comment says what it counts.
- [NIT] not taken: CI's run sets no trace (a CI pass still means the newest is wholly on screen); no scenePhase check
  (a background scroll is harmless); an end marker's onAppear just below the box can make a look stand down early
  (not the measured case).

#### Measured 11-26 05:1x, at 6d54df5ddb (iPhone 17, iOS 27, x3 each)

- lazy WITH the fix: tall20 FAILED 3 of 3 (newest at 878-936 against a band ending 797: opened short, as the bug);
  short20 passed 3 of 3.
- lazy WITHOUT the fix: tall20 failed (the control behaves).
- So the head's fix did not fire. Cause (from the code): round 1's personMoves counted every scroll REST
  (PersonScroll's rested fires on any change to idle, including the list's own settling and animations), so the open's
  first look already saw a "move" and every look stood down. Angel's original (no personMoves) passed 6 of 6.
- Fix: personMoves now counts only when personScrolling turns true (the interacting, decelerating and tracking phases;
  PersonScroll never sets it for animating), plus a sample walk's start. Re-measured below.
- Re-measured 11-26 07:20 at 23573eefcf: lazy WITH the fix, tall20 PASSED 3 of 3 (newest 666-724, inside the band
  116-797, first and second open), short20 passed 3 of 3. With the 05:1x lazy WITHOUT the fix (failed 3 of 3, its path
  unchanged since) and UIKit (6 of 6), the pass is shown to come from the fix. Posted on #9089 (comment 7193292665).

#### Iteration 4 (blind review of the whole branch, opus)

No BLOCKER, no SHOULD-FIX. Converged. Known limits, recorded rather than fixed (each narrow, none a regression):
- A scroll without a finger on iOS 18+ (a status-bar tap, VoiceOver's scroll) runs in the animating phase, so it is not
  counted; a look landing inside that animation, in the first 1.6 s, puts the reader back at the end.
- iOS 17 (no scroll phases): a drag that ends with no momentum before a look is not seen; and if the end shows then is
  pushed down, iOS 17 clears atBottom on its disappearing, so the looks do not fire there (unmeasured on iOS 17).
  UIKit's own scroll state could count moves on every iOS: a follow-up if iOS 17 matters.
- The looks start when the KEPT copy is drawn; a live read landing later with taller rows falls outside them (the
  existing keep-at-end path covers it). Beside the weakest premise above.
- A look during a keyboard rise within 1.6 s of opening could be one step (same target; unmeasured).
- The sample walk counts personMoves twice on one change (harmless).
