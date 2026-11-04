# connecting-7954: the iPhone's first-connect wait says "Connecting..." with the board's ring of dots

Card: kosmos#7954. Josh 11-04 10:36: "On this let's say "Connecting..." and use our simple dots that go in a circle since
they are smaller."

## Decided
- "Our simple dots that go in a circle" is the board's Sweep loader (web/index.html .spin-sweep, #2236): eight dots on a
  ring lighting clockwise. The iPhone never had it (before #7896 it used ProgressView), so it is ported: SweepLogic.swift
  (the numbers, UIKit-free, tested on a Mac) and SweepDots.swift (the view). Rejected: WorkingDots / WaveDots /
  LayerWaveDots (three dots in a row, not a circle); ProgressView (the system's spokes, the thing #7896 retired).
- All three "Reaching your computer..." waits change (Agents, Projects, Settings' notification row), words and dots, so
  the same wait reads the same everywhere. Every other loading place keeps the orb (#7896).
- Weakest premise: Josh's words named one screen, and #7896 said the orb goes everywhere. Overturned in a sentence by
  reverting the two other sites.

## Not measured
- The look on a device (no simulator screenshot: the screen needs a signed-in, still-connecting state).
- Whether a cold signed-in launch going still orb (#7945) then dots should match is Josh's one-line call.

## Steps
1. SweepLogic + SweepDots + the three sites. done
2. ios/LogicTests/run-sweep.sh + CI step; a counter-clockwise mutant fails it. done
3. Simulator SDK build. done
