# korbios-7896: the iPhone app's loading mark is the KOSMOS orb (kosmos#7896, slice 4)

Finished means: every ProgressView in ios/Kosmos (42, in 17 files) is the KOSMOS orb, at the size, colour and spoken
label each had, turning while shown, still (K facing) with Reduce Motion, the same orb as the desktop.

Josh, 11-03 18:43 CST: "On the mobile apps that would be great to have it."

Decided:
- OrbLogic.swift is the desktop's KORB geometry ported line for line (same Lehmer seed 7, same acceptance, currents,
  letter cuts, grouped paint), Foundation only, so LogicTests run it on a Mac; KosmosOrb.swift is the SwiftUI view
  (TimelineView at 30 fps, Canvas, one path per strength group).
- Mapping: ProgressView() to KosmosOrb() (20 pt); .controlSize(.small) to size 16; .controlSize(.large) to size 36;
  .tint(X) to colour: X (white and card tints on coloured grounds kept); .accessibilityLabel(X) to label: X, passed
  in rather than stacked, so VoiceOver says exactly what each site said. Default label "Loading".
- Colour: Palette.starGold (deep gold #9c741b in light, which holds 3:1 on the light grounds where the desktop's
  #d6a62e measures about 2.1:1; bright gold in dark), as the star did for the same reason (kosmos#7034). Review round 1.
  The desktop's dots have the same light-ground contrast gap; recorded on the card, not changed in this slice.
- Where the row's own text already says what is loading (four combined rows), the orb is hidden from VoiceOver, so it
  does not say "Loading" twice.
- Each orb places its own dots (the desktop shares one placing); measured about 0.19 ms per frame on a Mac.
- Time is wrapped to the 27 s loop before the trigonometry (the clock's seconds are too large for it).
Rejected: a GIF or video asset (heavier, no Reduce Motion, blurry at small sizes).

Weakest premise: frame cost on an older iPhone with several orbs on one screen, not measured on a device. TimelineView
stops when the view is off screen; the next lever is fewer dots below 20 pt.

Tests: ios/LogicTests/run-orb.sh (also pins the desktop's place() at t = 0 and t = 13.37: counts 1627 and 1389 and one
dot each, red when one current constant changes) (wired into .github/workflows/ios.yml as "Orb logic tests"): 2200 dots and the first
equals the desktop generator's (computed in Node); K O S M O S at each facing and back to K at 27 s; no dot inside the
K at t = 0, with a CONTROL that the S's cut does hold dots then (so the K result is not vacuous); t = 27 s draws the
same frame as t = 0; grouped circles and the radius floor. Red when dots inside the cut are drawn (573 inside the K).
Rendered on a Mac with ImageRenderer at 16, 20, 36 and 72 pt and white on gold: the K reads at every size.
The app type-checks for iOS 16 (the deployment target) and the iOS 27 simulator SDK.
