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
(With Reduce Motion on, the wait pulses all eight dots together; since review 5 it fades into that pulse from the launch
frame rather than switching.)
Weakest premise: that the simulator's handover matches a real iPhone's. (Text size: review 3 made this wait's ring one
size at every text size; Reduce Motion: review 5 fades it from the launch frame into the pulse.) The bars still appear at the handover (they cannot be on a
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

## Review 4 changes
- KosmosUITests/LaunchHandoverUITests (in ios/tools/ui-sample.sh, so CI runs it): on a running app (sample board held
  on the wait), the ring's centre (the wait element's top + 10 pt, its middle across) is within 1 pt of the screen's
  centre, and the words run below it. Passes on iPhone 17e, iOS 27 (screen 390x844, ring centre y 422). Control: with
  the wait's ignoresSafeArea removed it FAILS (ring at y 431, 9 pt below), so a wrapper that moves it is caught.
- README: the retry wait's ring still scales with text, and names the UI check.

## Review 5 changes
- ConnectingWait (SweepDots.swift): the wait's shape in one view, used by the Agents tab's reaching wait and the
  Projects tab's first wait (a launch from a room notification opens on Projects; it showed the orb). Settings keeps the
  orb: it never follows the launch screen. run-sweep.sh checks ConnectingWait's shape and both uses.
- SweepLogic.shown: what SweepDots draws. Its first frame is the launch frame; with Reduce Motion it fades into the
  pulse over calmFrom (0.6 s), in place. sweep/main.swift 27/27; mutants red (Projects back on the orb, Agents not
  using ConnectingWait, the fade removed).
- DEFERRED: the UI check reads the combined element's frame (ring top + words). If a later iOS reports that frame
  differently, the check goes red, not green; measured on iOS 27.

## Review 6 changes
- Projects' first wait is now measured, not assumed: KOSMOS_SAMPLE_REACHING=1 holds the Projects list on its wait too
  (Debug, sample board only), and LaunchHandoverUITests has a second check on the Projects tab. Both pass on iPhone 17e,
  iOS 27 (ring within 1 pt of the screen's centre). ui-sample.sh counts 2.
- README: a return from the "Connecting to <Mac>" retry wait to the first wait starts that ring again at the launch
  frame (a new view). SweepDots' doc comment names both first waits.

## Review 7 changes
- ConnectingWait's words are laid out on the full-screen frame (overlay after the fill frame, a centre guide putting
  their top 18 pt below the centre), wrap, and keep 24 pt from the edges: at the largest text sizes "Reaching your
  computer..." would otherwise have run off both edges (pinned to the 20 pt ring with fixedSize()). run-sweep.sh's
  shape check follows. LaunchHandoverUITests gains a check at the largest accessibility size (words on screen, ring
  still at the centre); ui-sample.sh counts 3.
- README: iOS caches launch screens, so a phone updated from an earlier build may show the old one until the cache
  refreshes (a restart, or delete and reinstall).
- Noted, not changed: run-sweep.sh's Projects check is textual; the UI check measures it running.
- Measured: all three UI checks pass (iPhone 17e, iOS 27); control, the round-6 layout at the largest text size: words 481 pt wide from x -45.5 on a 390 pt screen, check FAILS.

## Review 8 (the cap)
- DEFERRED: "the .connecting wait follows .starting on a first connect". Read: BoardClient.swift:1921 is the only place
  .connecting is set, inside the .refused case (a gate that refused a hand-off, being retried). A normal first connect
  goes .starting -> .live, the one ConnectingWait.
- ConnectingWait's doc comment: the words get the screen's width less 24 pt each side (comment only, after the last
  blind review).
