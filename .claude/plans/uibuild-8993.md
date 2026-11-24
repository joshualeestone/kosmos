# uibuild-8993: build the sample-board app once per ios.yml run

Finished means: an ios.yml run builds the UI tests' app once, its three UI jobs (ui, uikit 1/2, uikit 2/2) test those
products without building, every test still runs, and the macOS minutes per run drop by about the two builds no longer
made. Measured after the merge as ios.yml queued-to-started and job-minutes per run, against the numbers below.

## Measured before (card #8993 comment 7136809428)
- 27 runs since 11-23: wait to first job median 11 min, max 114; 3,228 macOS job-minutes, 864 (27%) on main pushes.
- Per job median: build 29, ui 38, uikit halves 38 each. Inside a UIKit job, 28.4 min of tests in a 40.5 min action.
- Candidates: (1) main reuse by ios/ tree: 2 of 27 runs could reuse; (2) folding shards: same minutes; (3) path filter:
  drops coverage of a list release builds offer (Settings "New chat list"). (2) and (3) rejected; (1) small, later.

## Built
- ios/tools/ui-sample.sh: --build-only <dir> (build-for-testing, Debug, generic simulator; products + .xctestrun +
  xcode-version) and --products <dir> (test-without-building -xctestrun; another Xcode or no products: build here, said).
- ios.yml: job `uibuild` builds and uploads (1 day); ui and uikit need it, download it, pass --products.
- ios.uibuild-8993.test.js pins the wiring and the argument refusals (mutation checked).

## Measured here (Xcode 27.0, iOS 27.0 simulator)
- --build-only: PASS in 62 s, 93 MB of products.
- test-without-building from them on a fresh simulator: RoomTitleUITests 2/2 passed in 35 s; CONTROL without the
  TEST_RUNNER_* variables: both skipped (so the variables reach the tests through the .xctestrun).

## Weakest premise
That the upload of ~93 MB and three downloads cost less than two builds on GitHub's runners, and that the runner
image's Xcode is the same in uibuild and the UI jobs (else they fall back to building: slower, never red). The first runs
measure both.
