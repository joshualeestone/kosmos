# kosmos#7945 follow-up: the launch screen hands over to "Connecting..." with no jump

## Asked (Josh 20:58 on TestFlight 43, via Splinter)
Opening the app showed the big 120 pt launch orb, then a smaller orb behind "Reaching your computer...", then the app.
He wants the simple ring of eight dots (the Sweep loader, already on the Agents tab's wait since #7954, in build 44)
and no big-then-small jump.

## Finished looks like
The launch screen is the native ground with the Sweep ring at SweepLogic.launchAt (dot 0 at its brightest, three
trailing), 20 pt, Palette.starGold, drawn from SweepLogic; every SweepDots starts its loop at that same moment when it
appears, so the launch picture is the wait's first frame; the Agents tab's wait to connect centres its ring on the
screen (a launch image is always centred on the screen), with "Connecting..." hanging 8 pt below without moving it.
Measured in a simulator (iPhone 17 Pro, iOS 27, Debug with KOSMOS_SAMPLE_AGENTS=1 KOSMOS_SAMPLE_REACHING=1, frames
taken with simctl io screenshot through the launch, light and dark): see "Measured" below.

## Call
Static still frame at the ring's own size and place. Rejected: an animated launch (a launch screen cannot animate);
centring the launch image on the space between the bars (a launch image cannot be placed off centre per device, and
the bars' heights differ by iPhone), so the wait moves to screen centre instead.
Review 1: the first version showed Reduce Motion's still ring (eight equal dots at .85), which the moving sweep (one
lit dot, seven faint) would visibly lighten at the handover; now the launch picture is the sweep's first frame.
Remaining mismatch: with Reduce Motion on, the wait pulses all eight dots together, so it changes look at the handover.
Weakest premise: the Reduce Motion mismatch above, and that the simulator's handover matches a real iPhone's. (Text
size: review 3 made this wait's ring one size at every text size, scales: false, its words still grow.) The bars still appear at the handover (they cannot be on a
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

## Review 1 changes
- SweepLogic.launchAt (= peakAt * loop); SweepDots runs its loop from when it appears, starting there (was the wall
  clock mod 24); the launch PNGs are that frame. sweep/main.swift: two checks on the frame (23/23).
- run-sweep.sh: the wait's shape is checked in order with comments stripped (ring, overlay, Connecting, fill frame,
  ignoresSafeArea; no stack), and SweepDots' start at launchAt. Mutants red: the old VStack shape, ignoresSafeArea only in
  a comment, SweepDots on the wall clock, launchAt changed without redrawing (STALE).

## Measured in a simulator (after review 2's fix, iPhone 17 Pro 1206x2622, iOS 27)
- Launch frames: ring box x 574-629, y 1281-1337 (3x px), centre (601.5, 1309); screen centre (602.5, 1310.5).
- Wait frames after the handover: box edges move 2-3 px as dots grow and shrink (lit 1.08, rest 0.6), centre within
  (601-604, 1309-1312) in every frame; same ground (#0c0d0f dark, #faf9f7 light) on both.
- The first app frame is iOS's cross-fade (launch picture and the moving ring overlaid); the sweep then runs on.
- First version (before review 1) measured the same way: launch box x 573-632 y 1281-1340, wait within 1 px.
- Not measured: a real iPhone; Reduce Motion. (Larger text sizes: the ring no longer scales here, review 3.)

## Review 2 changes
- BoardStates draws the wait in one place (body: `if waiting { reaching } else { states }`), so starting -> live while
  waiting keeps one ring and its loop (it restarted at launchAt with two call sites). run-sweep.sh checks one call site;
  its mutant (reaching back in the .starting arm) is red.

## Review 3 changes
- SweepDots gains `scales` (default true); the wait uses `SweepDots(scales: false)`, so the ring matches the fixed
  launch picture at every text size. Hidden from VoiceOver; the words still scale.
- run-sweep.sh's shape check also requires `scales: false` and the 8 pt alignment guide; the one-call-site count also
  counts `self.reaching`. Mutants red: guide removed, scaling back on, a second call as self.reaching.
- README: what is not covered (Reduce Motion; the rarer "Connecting to <Mac>" retry wait). run-sweep.sh header: the
  launch renderer is read from this checkout whatever directory is passed.
