# uiflake-8221: main's UIKit-list UI tests stop failing on a slow runner's timing

Card: joshualeestone/kosmos#8221 (Mona Lisa's note 11-12: main's ios "uikit list (sample board)" job red in 3 of its
last 5 runs, a different test each time). Off main.

## Finished looks like

The two shapes of failure measured in main's red runs no longer depend on how fast the runner is: a setup check that
races the app's own timed action, and a fixed page delay too short for a runner whose drags take 3 to 4.5 s. Each
test still checks the same behaviour, and CI's uikit list job passes on this branch.

## What the red runs show (measured)

From the logs of main's runs 42940677400, 42929557648 and 42906709675 (GitHub-hosted macOS runners) and the
xcresult of 42940677400:

1. **A11yScroll / A11yFocus, "CONTROL: the long chat did not open at its newest message".** The sample
   (KOSMOS_SAMPLE_A11YSCROLL / _A11YFOCUS = 6) acts by itself 6 s after the list opens and scrolls the newest row
   off screen; a UIKit row off screen does not exist. The test asked for that row after launching, with a 20 s
   wait, so a first look later than 6 s could never see it, however long it waited.
2. **EarlierDropped, "CONTROL: no row of the first page is drawn before the drop" (first try) and "the page before
   was not asked for again" (retry).** The timeline: each drag with XCTest's wait for idle took 3 to 4.5 s; the
   test stamps the ask when it SEES "Loading", up to a drag or two after the real ask; the drag back into the first
   page finished at 152.5 s and the check ran at 153.9 s, after the delete that comes 6 s after the real ask. In the
   retry the re-asked page had already landed, and its Loading line gone, before the test looked at 155.2 s.
   EarlierDeleteShift has the same shape; its own comment records the delay already raised once (to 8) for this.

## Decided

- A11yScroll / A11yFocus: the chat opened at its newest message if that row shows OR the timed action already
  reported (UIKitListArm.openedAtNewest). The report is made inside the app at the moment it acts and says whether it
  started at the newest message ("from the end true"); both tests already assert that, so nothing is checked less.
- EarlierDropped and EarlierDeleteShift: page delay 16 s (was 8). Every wait in them is computed from it. Tolerance
  for the late stamp goes from about 1 s to about 9 s; each test runs about 16 s longer.

Rejected: a longer timeout on the newest-row wait (it cannot help: the row is gone, not late); stamping the ask from
the app's trace (more machinery than the measured problem needs).

Not in this change, stated: ComposerSendUITests' dropped and moved keystrokes ("Lne one\nLine twoi"), already marked
FLAKY and retried by ui-sample.sh; A11yScrollUITests.testASlowScrollWithNoEndIsFollowedAndLetGo's ("8") != ("0") in run
42906709675, which is the product's own assertion (the list put itself back at the end during the person's scroll) and
may be a real timing rule under load (ChatList.personScrollQuiet 0.3 s), not a test race. It is left for its own look.

Weakest premise: that the hosted runner's 3 to 4.5 s per drag is the worst case; a slower runner can still exceed
9 s of stamp lag. Would change my mind: a red run of these tests on this branch with the same messages.

## Change

- ios/KosmosUITests/UIKitListArm.swift: openedAtNewest.
- ios/KosmosUITests/A11yScrollUITests.swift, A11yFocusUITests.swift: use it.
- ios/KosmosUITests/EarlierDroppedUITests.swift, EarlierDeleteShiftUITests.swift: delay 16.

## Results

- UI test files typecheck (swiftc -typecheck, iphonesimulator, with XCTest's frameworks and its Swift support);
  control: a misspelled member in the new helper fails it.
- The repo tests that read ios/ (13 files): 91 of 91.
- The proof that matters is CI's "uikit list (sample board)" job on this branch.
