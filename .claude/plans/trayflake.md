# trayflake (kosmos#7609)

Finished means: AttachMenuUITests wait for the tray's reported frame to hold still for 0.5 s before tapping it, and a red UI job on CI leaves its result bundle as an artifact for 7 days.

Why: main's UI job went red three times on 11-05 and 11-06, two in AttachMenuUITests, and CI kept nothing to read.

Rejected: retrying the tap (it would hide a real dropped tap); longer timeouts (the tap did nothing, so waiting longer would not help).

Weakest premise: the tap landing mid-slide is reasoned. 30 of 30 passed locally on the same phone and iOS, so this may not cure it. A second premise under it: the frame the wait reads may report where the tray lands rather than where it is, which would make the wait a plain 0.5 s pause. The artifact is what tells us if it does not. Nobody has yet forced a red and opened the artifact; the first real red does that.

Not covered: KeyboardSlideUITests.testComposerGrowingKeepsMessagesDrawn, the third red.
