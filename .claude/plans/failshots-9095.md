# failshots-9095 (kosmos#9095, the "only 1 of 4 failure screens ever seen" gap)

**Problem.** #9095 moved the iPhone's four failure screens (LoadFailureView: offline, Kosmos+ not answering, a computer not answering, a page that did not load) from navy and blue to the native ground with a gold Try again. Only one of the four had ever been seen rendered.

**Change.** `ios/KosmosUITests/FailureScreensUITests.swift` drives each screen with `KOSMOS_SAMPLE_FAILURE`, in light and dark, and reads the screenshot's pixels:
- the exact ground at both edges;
- no navy #17233D or old blue #2F57C4 on a 6-point grid above the tab bar;
- Try again filled gold #e3b341;
- the ground read again 2 s later.

A control test proves the judges can fail. The test is added to `ios/tools/ui-sample.sh` as 3 checks, so CI runs it. No app code changes.

**Decided.** Appearance is set through the board's own theme at launch (`-kosmos.boardTheme`, applied by BoardThemeProxy), not through the simulator:
- `XCUIDevice.appearance` changed nothing on 26.5;
- in a measured run, simctl dark left these screens light.

So a fresh CI simulator runs both halves, and neither can skip.

**Rejected.** Skipping a half when the simulator ignores the request (my first version). It left CI covering light only.

**Weakest premise.** It proves the board-theme path, not a phone in dark mode with the board on "system". The colours resolve from the same trait either way.
