# trayflake (kosmos#7609)

Finished means: a UI test taps the photo tray only once it has stopped moving, and a red UI job on CI leaves its result bundle as an artifact for 7 days.

Why: main's UI job went red three times on 11-05 and 11-06, two in AttachMenuUITests, and CI kept nothing to read.

Rejected: retrying the tap (it would hide a real dropped tap); longer timeouts (the tap did nothing, so waiting longer would not help).

Weakest premise: the tap landing mid-slide is reasoned. 30 of 30 passed locally on the same phone and iOS, so this may not cure it. The artifact is what tells us if it does not.

Not covered: KeyboardSlideUITests.testComposerGrowingKeepsMessagesDrawn, the third red.
