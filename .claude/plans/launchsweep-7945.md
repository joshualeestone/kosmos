# kosmos#7945 follow-up: the launch screen hands over to "Connecting..." with no jump

## Asked (Josh 20:58 on TestFlight 43, via Splinter)
Opening the app showed the big 120 pt launch orb, then a smaller orb behind "Reaching your computer...", then the app.
He wants the simple ring of eight dots (the Sweep loader, already on the Agents tab's wait since #7954, in build 44)
and no big-then-small jump.

## Finished looks like
The launch screen is the native ground with the Sweep ring's still frame (Reduce Motion's: every dot full size at
calmHigh), 20 pt, Palette.starGold, drawn from SweepLogic; the Agents tab's wait to connect centres its ring on the
screen (a launch image is always centred on the screen), with "Connecting..." hanging 8 pt below without moving it.
Measured in a simulator (iPhone 17 Pro, iOS 27): the ring's box on the launch screen and in the wait is the same to
within one 3x pixel, light and dark, on the same ground.

## Call
Static still frame at the ring's own size and place. Rejected: an animated launch (a launch screen cannot animate);
centring the launch image on the space between the bars (a launch image cannot be placed off centre per device, and
the bars' heights differ by iPhone), so the wait moves to screen centre instead.
Weakest premise: at a larger text size SweepDots grows (ScaledMetric) and the launch mark does not, so a person with
large text sees the ring grow a little at the handover. The bars still appear at the handover (they cannot be on a
launch screen).

## Changes
- LaunchOrb.imageset -> LaunchSweep.imageset (PNGs from ios/tools/launch-sweep/main.swift, render-launch-sweep.sh),
  Kosmos-Info.plist UIImageName, check-app-assets.sh, README.
- The launch checks move from run-orb.sh to run-sweep.sh (they now compile SweepLogic), plus two: the mark's side
  equals SweepDots' default size, and the reaching wait is SweepDots with ignoresSafeArea.
- AgentsView.reaching: ring centred on the screen, words as an overlay below it.
- BoardClient: KOSMOS_SAMPLE_REACHING=1 (Debug, with KOSMOS_SAMPLE_AGENTS=1) holds the wait, to photograph it.

## Measured
run-sweep.sh PASS 21/21 with the launch checks; run-orb.sh PASS. Mutants red: SweepDots size 24 (size check), the
wait's ignoresSafeArea removed (centre check), a wrong 2x PNG (stale check).
