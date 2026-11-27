# hopgame-9091: "Hop", a one-tap offline game under the iPhone's offline screen (kosmos#9091)

## Decided (11-26 09:0x, on the card): concept B, Hop
Josh's 16:41 input: the offline dinosaur game as the model, one tap, a high score. B is the only concept that is all
three. Rejected A (hold-to-pull, ends when the K is whole) and C (many taps, survival time). Original: nothing from the
dinosaur game but the one-button idea. Target look: ~/work/design-shots/offline-game-9091/B-hop.png.

## Shape
- Only on the OFFLINE failure (Shell.LoadFailure.offline), below Try again, inside LoadFailureView. The other three
  failure screens are unchanged. Back online: the screen goes as today (the game never delays the reload).
- A rounded panel on the icon's gold gradient (#ECB115 to #CE9800, from dots.json), score top left, "Best N" top right,
  a faint K of the 153 measured dots (dots.json centres and radii) behind, a dotted ground line, "Tap to hop over the
  drifting dots" until the first tap.
- One tap = one hop (no double hop while airborne). Clusters of 1 to 3 cream dots drift in from the right; the pace
  rises with the score. Touching a cluster ends the run; a tap restarts. Each cluster cleared lights one dot of the K
  with the icon's spring (anim2.py: kspring 0.004 to 0.026, damping 0.01 to 0.18, per frame at 30 fps).
- Best score kept in UserDefaults (one integer, local only; nothing sent anywhere).
- Accessibility: Reduce Motion shows the static K and no game; VoiceOver reads "Offline game, best N" and the game is
  not in the focus order beyond one element (it never traps focus away from Try again).

## Files
- ios/Kosmos/HopLogic.swift (new, pure, no SwiftUI): the state, step(dt), tap(), collision, scoring, pace, cluster
  spawning from an injected RNG, the K-dot lighting order, the spring. All the rules live here.
- ios/Kosmos/HopGameView.swift (new): TimelineView/Canvas drawing of HopLogic's state; the panel.
- ios/Kosmos/ShellViews.swift: LoadFailureView shows HopGameView under the buttons for .offline only.
- ios/Kosmos/KDots.swift (new): the 153 dots, generated from dots.json (a generator note in the file).
- Tests: ios/LogicTests (the existing Swift logic suite): hop arc, no double hop, collision both ways, score, pace,
  best kept, seeded spawns deterministic, spring settles. Node source test ios.hopgame-9091.test.js: the game only on
  .offline, no blue, Reduce Motion honoured, best score never leaves the device (no network call in the files).
- Screenshot hook: KOSMOS_SAMPLE_FAILURE=offline already holds the screen; add KOSMOS_SAMPLE_HOP=<seed>,<frame> to
  freeze a mid-run frame for shots (Debug only).

## Order
1. HopLogic + its logic tests. 2. KDots. 3. HopGameView + LoadFailureView wiring. 4. node source test. 5. gates,
blind review (8 max, one at a time, alternate models, last whole-branch). 6. iOS shots light/dark. 7. validation, PR.
