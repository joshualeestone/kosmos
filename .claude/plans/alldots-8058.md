# alldots-8058: the dots are the iPhone app's only loading indicator

Josh 2026-11-05 18:33 (via Splinter): "Im still getting the wrong spinner in the mobile app. Let's say that we only use
the dots spinner in the mobile app and scrub any other instances". This widens #8058 (small waits, merged in #8073) to
every wait, full-screen ones included, overriding the earlier rule that whole-screen waits keep the orb.

## Change

- Every `KosmosOrb` in the app (30 sites across 13 screens) becomes `SweepDots`, with the same colour and the orb's
  fixed size (`scales: false`, so nothing grows in toolbars or buttons at large text sizes).
  VoiceOver unchanged: the orb said "Loading" unless hidden, so an unlabelled orb becomes `SweepDots(label: "Loading")`
  and a hidden one plain `SweepDots()` (hidden by default); a labelled one keeps its label.
- The system's own spinner remains in one place: pull to refresh (10 `.refreshable` lists and the board page's
  `UIRefreshControl`). Dots there need pull to refresh rebuilt; follow-up card, said on #8058.
- Guard in the sweep suite, subfolders included: no app source (ios/Kosmos, ios/KosmosNotice) may contain
  `KosmosOrb(`, `ProgressView(` or `UIActivityIndicatorView`, and pull to refresh is pinned at its 11 places so none
  is added. KosmosOrb.swift is unused and excluded; it can be deleted with its project entry.
- Doc comments in SweepDots and KosmosOrb say so.

Not in scope, said on the card: the board's own web pages shown inside the app (their spinner is the web's, #7896).

## Checks

- All iOS logic suites; the guard fails on a tree with a system spinner (measured against an older main).
- CI; the next TestFlight (Angel cuts right after the merge).
