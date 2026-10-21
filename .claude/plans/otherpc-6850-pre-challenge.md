---
method: challenge-loop
branch: otherpc-6850
diff_hash: 4ac5399e427f986f82664e662d11ae7264a1be7613e6acecf513714b0dce0e98
timestamp: 2026-10-21T19:34:28Z
subdir_audit: passed
iterations: 2
converged: true
---

# Challenge-loop proof: otherpc-6850 (kosmos#6850, the iPhone app's "Choose another computer")

The "Your Mac isn't answering" page in the iPhone app offers Choose another computer, which opens
login.kosmosplus.com/account (the computer list with Open on each answering row, kosmos-relay macopen-6850).
Two blind iterations; each iteration's fixes are in its commit message.

#### Iteration 1 (Opus): one BLOCKER, warnings, nits, all FIXED (668a195)
- BLOCKER: WebView never declared otherComputerCount, so the app did not compile. LogicTests compile the
  UIKit-free files only and stayed green; the simulator build is the check that sees it.
- makeUIView syncs lastOtherComputer like lastRetry/lastBack, so a rebuilt WebView cannot replay an old tap.
- The outlined button takes taps across its whole row.

#### Iteration 2 (Sonnet): no blocker, warning or convention finding. One nit, FIXED after the round (481c6f9)
- contentShape moved onto the button's label, where hit-testing reads it (one modifier moved, not re-reviewed).

#### Validation
- LogicTests 247/247 at 668a195 (481c6f9 touches only ContentView, which they do not compile).
- iOS simulator build of 481c6f9: BUILD SUCCEEDED (queued-heavy, 14:33 CDT), Kosmos.app binary produced.
