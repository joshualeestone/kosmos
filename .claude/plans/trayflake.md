# trayflake (kosmos#7609)

Finished means: AttachMenuUITests wait for the tray's reported frame to hold still for 0.5 s before tapping it, and a red UI job on CI leaves its result bundle as an artifact for 7 days.

Why: main's UI job went red three times on 11-05 and 11-06, and CI kept nothing to read. Two were in AttachMenuUITests; only the 11-06 one is about tests still in the file (testPhotosOpensFromARoom has gone).

Seen: the wait after a tap expired (All photos at 20 s, a tile at 10 s). Not seen: whether either tap landed, since no bundle exists. A system picker slow to start on a loaded runner is not ruled out for All photos.

Rejected: retrying the tap (it would hide a real dropped tap); longer timeouts, for now (the artifact from the next red says whether they would help).

Weakest premise: the tap landing mid-slide is reasoned. 30 of 30 passed locally on the same phone and iOS, so this may not cure it. A second premise under it: the frame the wait reads may report where the tray lands rather than where it is, which would make the wait a plain 0.5 s pause. The artifact is what tells us if it does not. 

Not covered: a job cancelled at its time limit leaves no artifact. KeyboardSlideUITests.testComposerGrowingKeepsMessagesDrawn, the third red.

First real red (run 42184198471, on this branch's own CI): the artifact downloaded and opened by name. It showed testTheLastRowScrollsClearOfTheBottomRow crashing on the frame of a tile the lazy grid had dropped mid-scroll, so that read now allows for it. Its real assert still needs the tile at the end.

Second red with a bundle (run 42192726744): testTheRingComesAndGoesInARoom found no ring because the 6 s ring had come and gone before the first query; the tree held blank-ring-was-shown. Both ring tests accept that marker, which appears only once a ring has shown (testANormalOpenNeverShowsIt pins that).
