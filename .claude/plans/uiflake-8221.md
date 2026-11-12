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

- A11yScroll / A11yFocus: the chat opened at its newest message if that row shows, OR the timed action's report says
  the newest row was on screen when it acted (UIKitListArm.openedAtNewest, reading "newest shown true"). The report
  gets that field from ChatList.newestOnScreen (debug only): any of the newest row inside the visible part of the
  list, the same fact the old check's "row exists" meant, read from where the list is. Not atEnd ("from the end"),
  which is what the list means to do and stays true if the list opened elsewhere without a scroll event (iteration 1).
  Not newestShown(), which needs the newest wholly above the box and is false for a tall newest message.
- EarlierDropped and EarlierDeleteShift: page delay 16 s (was 8). The waits that hang on the page delay are computed
  from it; the fixed ones (the 10 s wait for the re-ask, two short sleeps) hang on the 5 s read cadence and stay. Tolerance
  for the late stamp goes from about 1 s to about 9 s; each test runs about 16 s longer.

Rejected: a longer timeout on the newest-row wait (it cannot help: the row is gone, not late); raising the samples'
6 s timer instead (launch alone took 13 to 26 s on CI, a first look 29.5 s after launch, so it would need about 40 s,
about 12 more minutes on a job that already takes 70 of its 80); stamping the ask from the app's trace (more machinery
than the measured problem needs). EarlierDoubleAskUITests (delay 8) has the same late stamp but no drag after it, so
about 6.5 s of tolerance; left as it is, the next candidate if it flakes.

Not in this change, stated: ComposerSendUITests' dropped and moved keystrokes ("Lne one\nLine twoi"), already marked
FLAKY and retried by ui-sample.sh; A11yScrollUITests.testASlowScrollWithNoEndIsFollowedAndLetGo's ("8") != ("0") in run
42906709675, which is the product's own assertion (the list put itself back at the end during the person's scroll) and
may be a real timing rule under load (ChatList.personScrollQuiet 0.3 s), not a test race. It is left for its own look.

Weakest premise: that the hosted runner's 3 to 4.5 s per drag is the worst case; a slower runner can still exceed
9 s of stamp lag. Would change my mind: a red run of these tests on this branch with the same messages.

## Change

- ios/Kosmos/ChatList.swift: newestOnScreen (debug only); "newest shown" in the two sample reports.
- ios/KosmosUITests/UIKitListArm.swift: openedAtNewest.
- ios/KosmosUITests/A11yScrollUITests.swift, A11yFocusUITests.swift: use it.
- ios/KosmosUITests/EarlierDroppedUITests.swift, EarlierDeleteShiftUITests.swift: delay 16.

## Results

- The app typechecks plain and with -D DEBUG, and the UI test files typecheck (with XCTest's frameworks and its
  Swift support). Controls: a misspelled member in the test helper fails the UI typecheck; one in newestOnScreen fails
  the DEBUG typecheck.
- No LogicTests runner compiles ChatList.swift (git grep over ios/LogicTests/*.sh), so they cannot change.
- The repo tests that read ios/ (13 files): 91 of 91.
- The proof that matters is CI's "uikit list (sample board)" job on this branch.

## Challenge loop

- Iteration 1 (opus): 1 WARNING FIXED: the first version accepted the timed action's report as proof the chat opened
  at its newest, but the report's "from the end" is atEnd (what the list means to do), so a list opened elsewhere
  without a scroll event would have passed the setup check the old row check caught. The report now carries a position
  fact (newest shown, ChatList.newestOnScreen) and the check requires it. NITs FIXED in this plan: "nothing is checked
  less" removed; "every wait" narrowed. Noted: EarlierDoubleAsk has about 6.5 s of tolerance and is left.
