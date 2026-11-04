# connecting-7954: the iPhone's first-connect wait says "Connecting..." with the board's ring of dots

Card: kosmos#7954. Josh 11-04 10:36: "On this let's say "Connecting..." and use our simple dots that go in a circle since
they are smaller."

## Decided
- "Our simple dots that go in a circle" is the board's Sweep loader (web/index.html .spin-sweep, #2236): eight dots on a
  ring lighting clockwise. The iPhone never had it (before #7896 it used ProgressView), so it is ported: SweepLogic.swift
  (the numbers, UIKit-free, tested on a Mac) and SweepDots.swift (the view). Rejected: WorkingDots / WaveDots /
  LayerWaveDots (three dots in a row, not a circle); ProgressView (the system's spokes, the thing #7896 retired).
- The Agents tab only: its first-connect wait (`reaching`, now "Connecting...") and its slower `.connecting(mac)` state
  ("Connecting to <Mac>.") both take the dots, so one wait has one mark. Every other loading place keeps the orb (#7896).
- Review 1 narrowed it: Projects' and Settings' "Reaching your computer..." waits are reads from a computer the phone can
  already be connected to, so "Connecting..." would be wrong there; they keep the orb and their words.
- Weakest premise: that `.connecting(mac)` is the same wait Josh saw. Overturned by putting the orb back there.

## Not measured
- The look on a device (no simulator screenshot: the screen needs a signed-in, still-connecting state).
- Whether a cold signed-in launch going still orb (#7945) then dots should match is Josh's one-line call.

## Steps
1. SweepLogic + SweepDots + the three sites. done
2. ios/LogicTests/run-sweep.sh + CI step; a counter-clockwise mutant fails it. done
3. Simulator SDK build, as ios.yml runs it: `xcodebuild -project Kosmos.xcodeproj -target Kosmos -sdk iphonesimulator
   -configuration Debug CODE_SIGNING_ALLOWED=NO build` (SYMROOT outside the worktree): BUILD SUCCEEDED. done
4. Review 1: the suite reads web/index.html and pins every copied constant to the board's CSS text (control: a moved
   keyframe fails it), so ios.board-parity-7084.test.js also runs it; edge checks at 72%; a lit dot stays in its box.
