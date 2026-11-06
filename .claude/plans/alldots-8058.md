# alldots-8058: the dots are the iPhone app's only loading indicator

Josh 2026-11-05 18:33 (via Splinter): "Im still getting the wrong spinner in the mobile app. Let's say that we only use
the dots spinner in the mobile app and scrub any other instances". This widens #8058 (small waits, merged in #8073) to
every wait, full-screen ones included, overriding the earlier rule that whole-screen waits keep the orb.

## Change

- Every `KosmosOrb` in the app (30 sites across 13 screens) becomes `SweepDots`, with the same size and colour.
  VoiceOver unchanged: the orb said "Loading" unless hidden, so an unlabelled orb becomes `SweepDots(label: "Loading")`
  and a hidden one plain `SweepDots()` (hidden by default); a labelled one keeps its label.
- No system spinner (`ProgressView`, `UIActivityIndicatorView`) was in the app; none added.
- Guard in run-sweep.sh's suite: no app source (ios/Kosmos, ios/KosmosNotice) may contain `KosmosOrb(`,
  `ProgressView(` or `UIActivityIndicatorView`. KosmosOrb.swift stays for its own logic tests.
- Doc comments in SweepDots and KosmosOrb say so.

Not in scope, said on the card: the board's own web pages shown inside the app (their spinner is the web's, #7896).

## Checks

- All iOS logic suites; the guard fails on a tree with a system spinner (measured against an older main).
- CI; the next TestFlight (Angel cuts right after the merge).
