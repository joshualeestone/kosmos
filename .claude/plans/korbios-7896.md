# korbios-7896: the iPhone app's loading mark is the KOSMOS orb (kosmos#7896, slice 4)

Finished means: every ProgressView in ios/Kosmos (42, in 17 files) is the KOSMOS orb, at the size, colour and spoken
label each had, turning while shown, still (K facing) with Reduce Motion, the same orb as the desktop.

Josh, 11-03 18:43 CST: "On the mobile apps that would be great to have it."

Decided:
- OrbLogic.swift is the desktop's KORB geometry ported line for line (same Lehmer seed 7, same acceptance, currents,
  letter cuts, grouped paint), Foundation only, so LogicTests run it on a Mac; KosmosOrb.swift is the SwiftUI view
  (TimelineView at 15 fps, Canvas, one path per strength group).
- The sign-in Confirm button, busy and so disabled with a grey fill, draws its orb in Palette.secondary, not the card
  colour that would vanish on the grey (round 7), and keeps the button's words as its spoken label.
- Mapping: ProgressView() to KosmosOrb() (20 pt); .controlSize(.small) to size 16; .controlSize(.large) to size 36;
  .tint(X) to colour: X (white and card tints on coloured grounds kept); .accessibilityLabel(X) to label: X, passed
  in rather than stacked, so VoiceOver says exactly what each site said. Default label "Loading".
- Colour: Palette.starGold (deep gold #9c741b in light, which holds 3:1 on the light grounds where the desktop's
  #d6a62e measures about 2.1:1; bright gold in dark), as the star did for the same reason (kosmos#7034). Review round 1.
  The desktop's dots have the same light-ground contrast gap; recorded on the card, not changed in this slice.
- Orbs on screen in one frame share one placing (time rounded to the 15 fps frame), as the desktop does (round 2);
  measured about 0.2 ms per frame for place and grouping on a Mac; the FILL is the cost (round 3): 2.6 to 4 ms per
  orb per frame at 3x as ellipses, 0.64 ms at 16 pt once sub-pixel dots are filled as squares. Every orb runs at 15 fps
  (round 4: one rate, so orbs of two sizes share one placing). Sub-pixel dots are squares of the same area. The dots and letter cuts are built off the main
  thread at launch (OrbLogic.warm), so the first orb shown does not stall a frame.
- VoiceOver: the orb is hidden wherever text beside it, or the button it sits in, says what is happening (15 sites), and says "Loading" (or the
  site's own label) where it stands alone.
- List and Form rows (7 sites) keep a bare orb, not wrapped to centre: a row lays out its content from the leading
  edge, and the bare ProgressView there was the same kind of fixed-size leaf. Reasoned, not measured on a device:
  if a screenshot shows the old spinner centred there, wrap those 7 in Spacers.
- Time is wrapped to the 27 s loop before the trigonometry (the clock's seconds are too large for it).
Rejected: a GIF or video asset (heavier, no Reduce Motion, blurry at small sizes).

Weakest premise: frame cost, and how faint the 16 pt orb reads, on an older iPhone; neither is measured on a device
(the Mac render at 3x reads, and the fill is measured on a Mac). The .animation schedule pauses with the app in the
background; whether it pauses for a view kept alive out of sight is not verified. The next lever is fewer dots below
20 pt.

Follow-ups on the card: re-pin the desktop parity numbers when korb-7896 merges (they come from that branch); check
the 7 bare list-row orbs' alignment in the next TestFlight build (reasoned leading, not measured).

Tests: ios/LogicTests/run-orb.sh (also pins the desktop's place() at t = 0 and t = 13.37: counts 1627 and 1389 and one
dot each, red when one current constant changes) (wired into .github/workflows/ios.yml as "Orb logic tests"): 2200 dots and the first
equals the desktop generator's (computed in Node); K O S M O S at each facing and back to K at 27 s; no dot inside the
K at t = 0, with a CONTROL that the S's cut does hold dots then (so the K result is not vacuous); t = 27 s draws the
same frame as t = 0; grouped circles and the radius floor. Red when dots inside the cut are drawn (573 inside the K).
Rendered on a Mac with ImageRenderer at 16, 20, 36 and 72 pt and white on gold: the K reads at every size.
The app type-checks for iOS 16 (the deployment target) and the iOS 27 simulator SDK.
