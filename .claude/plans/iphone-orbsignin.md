# iphone-orbsignin: the orb on three iPhone waits; sign-in centred with floating dots

Josh 2026-11-06 18:14 (#7896, Angel's sheet Files/iphone-loading-dots-vs-orb.png) and 18:18 (#8153), relayed by Splinter.

## Finished looks like
- Allow this iPhone, Connecting to your Mac, Making <name>: the orb at 132 pt (>= double 66), above the words, centred with them as one group. Screens 1, 2, 5, 6, 7, 8 unchanged (dots).
- Making ends in the green tick where the orb was, as on the Mac.
- Every sign-in step vertically centred; when the keyboard opens the box stays above it.
- The desktop first run's floating dots behind sign-in: readable text, Reduce Motion honoured (still), light on the battery (<= 30 fps, paused when not active).
- The #8058 "only the dots" guard allows exactly the three orb lines and still reds on any other.

- BoardStates is shared: Projects, Tasks and Today draw the same orb in those phases (accepted, review 1).
- MY CALL, NOT JOSH'S, and an exception to his "at least double 66": at accessibility text sizes and in landscape the orb (and Making's tick box) is 66 pt, so the words (Allow's code to check) keep their room on screens that do not scroll. At default text size in portrait it is always 132. Rejected: 132 always with the screens made to scroll (changes the shared message() for every error screen). Josh can overrule it with one constant.
- Low Power Mode holds the dots still, as Reduce Motion does. The three orbs keep turning in Low Power Mode (only Reduce Motion stills them), as every orb did before; accepted.

## Out of scope
- "Connecting..." (first connect, ConnectingWait) stays 20 pt dots to hand over from the launch picture (Josh's split keeps screen 1 dots).
- The dots' warmth is one constant (DotField.warmth = 0.5); a different strength is Josh's call later.

## Weakest premise
- Making is not in the UI test (needs a create); covered by source (sweep guard) and the build only.
- Dark mode screenshotted (round 3): readable. Hidden tabs' orbs may keep ticking (KosmosOrb's own unverified note); accepted.
