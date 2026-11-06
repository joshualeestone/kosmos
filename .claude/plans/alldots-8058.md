# alldots-8058: the dots are the iPhone app's only loading indicator

Josh 2026-11-05 18:33 (via Splinter): "Im still getting the wrong spinner in the mobile app. Let's say that we only use
the dots spinner in the mobile app and scrub any other instances". This widens #8058 (small waits, merged in #8073) to
every wait, full-screen ones included, overriding the earlier rule that whole-screen waits keep the orb.

## Change

- Every `KosmosOrb` in the app (30 sites across 13 screens) becomes `SweepDots` with the same colour and the orb's
  fixed size (`scales: false`, so nothing grows in toolbars or buttons at large text sizes).
- Two deliberate differences from the orb. Frame rate: the dots' own 30 a second (the board's); 15 made the ring step
  unevenly, and none of these sites is inside a chat or room thread, where 15 stays (#7427). Reduce Motion: the dots
  pulse, the dots' own rule (#4591: still dots read as frozen), where the orb held still; the in-thread sites hold still.
- The app no longer warms the orb's geometry at launch. Follow-up, not here: delete KosmosOrb.swift (the project syncs
  its folder) and OrbLogic.warm.
- The system's own spinner remains in one place: pull to refresh (10 `.refreshable` lists and the board page's
  `UIRefreshControl`). Dots there need pull to refresh rebuilt: #8078 (Renet Tilley).
- Guard in the sweep suite, subfolders included: no app source (ios/Kosmos, ios/KosmosNotice) may contain
  `KosmosOrb`, `ProgressView`, `.progressViewStyle` or `UIActivityIndicatorView`, and pull to refresh is pinned at its 11 places so none
  is added. KosmosOrb.swift is unused and excluded; deleting the file is enough (the project syncs its folder).
- Doc comments in SweepDots and KosmosOrb say so.

Kept on purpose: the three-dot wave on working lines and the Agents pill shows an agent working, not a wait (Josh
asked for it, #7427). Not in scope, said on the card: the board's own web pages shown inside the app (their spinner is the web's, #7896).

## Checks

- All iOS logic suites; the guard fails on a tree with a system spinner (measured against an older main).
- CI; the next TestFlight (Angel cuts right after the merge).
