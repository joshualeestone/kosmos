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
- ios.yml: job `uibuild` builds and uploads (3 days, see round 1); ui and uikit need it, download it, pass --products.
- ios.uibuild-8993.test.js pins the wiring and the argument refusals (mutation checked).

## Measured here (Xcode 27.0, iOS 27.0 simulator)
- --build-only: PASS in 62 s, 93 MB of products.
- test-without-building from them on a fresh simulator: RoomTitleUITests 2/2 passed in 35 s; CONTROL without the
  TEST_RUNNER_* variables: both skipped (so the variables reach the tests through the .xctestrun).

## Weakest premise
That the upload of ~93 MB and three downloads cost less than two builds on GitHub's runners, and that the runner
image's Xcode is the same in uibuild and the UI jobs (else they fall back to building: slower, never red). The first runs
measure both.

## Round 1 (opus) fixes
- BLOCKER: products travel as one tar (an artifact drops file modes; the app and test runner executables need +x).
  Measured: all 11 executables keep +x through tar -c / tar -x of the real products (97 MB).
- BLOCKER: the failure notes find the app in $appdir (the shared products, or the run's own build), not only in a
  build folder the shared run never makes.
- One artifact name per run with overwrite: true, so "Re-run failed jobs" on a UI job finds its run's products; the
  download continues on error and the UI job then builds the app itself (3-day retention for re-runs).
- --build-only refuses a folder that is neither empty nor a products folder it made (it replaces the folder whole).
- Tests: both xcodebuild lines must carry the same test arguments and variables (with a control); the failure notes'
  lookup; the tar steps; the refusal leaves the folder untouched. Mutations checked.
- Throughput, recorded honestly: a run still peaks at four macOS runners (the logic build plus three UI jobs, after
  uibuild); the saving is job-minutes (two builds), and the UI jobs now start after uibuild. Measure after merge: job-
  minutes per run, and queued-to-UI-start, not only queued-to-first-job.
- My slip, recorded: I edited ui-sample.sh while a local run was executing it; bash resumed at a shifted offset and died
  ("line 223: fi", rc=2) while its wrapper reported exit 0. Killed by recorded pid and re-run on the final script.

## Round 2 (sonnet) fixes
- MEASURED the tar round trip end to end: a full lazy-arm run (60 tests) from tar-extracted products ran all 60, 58
  passed; the 2 reds were EndPullUITests, the known failure also red on main (Ice Cream Kitty m6342, evidence on #8072),
  being re-checked built vs shared on this Mac. The tar copy passes codesign --verify --deep --strict; the .xctestrun
  uses __TESTROOT__ (16 times) and holds no absolute path.
- Products were fat (x86_64 + arm64; `xcodebuild test` on one simulator builds one): build-for-testing now passes
  ARCHS=$(uname -m). Measured: arm64 only, 46 MB (was 93).
- uibuild verifies the tar round trip itself (extract, codesign each app) and tars with COPYFILE_DISABLE=1; upload at
  compression-level 0; a missing shared build is a ::warning; the header says a skipped UI job means not tested.
- ui-flaky-count.sh: a UI job skipped by a red uibuild is reported (finalised in round 3 as its own line).
- --build-only replaces only a folder holding its own marker (.ui-sample-products), cleans its temp build on any exit;
  the shared run keeps its derived data in the run's own mktemp folder ($work, under TMPDIR), removed with the run.

## Round 3 (opus) fixes
- The throughput cost said in ios.yml itself: the UI jobs ask for a runner only after uibuild, so on a congested queue
  a run waits twice. Fewer minutes should shorten the queue for everyone; a run's own start-to-verdict is measured after
  merge, not assumed. (Round 3 measured job 138412380241: about 14 of 43 min were build and runner start.)
- The download is checked against a sha256 uibuild uploads with it; a mismatch, a cut-short tar or one that will not
  unpack falls back to building with a warning (no longer red).
- ui-sample.sh: --products made absolute (xcodebuild runs from ios/); a failed copy or version stamp is red; the marker is
  written first (an interrupted build can be rebuilt into); the stamp holds Xcode, build, architecture, and the commit
  (a mismatch in Xcode or architecture builds here; another commit is named); --keep with --build-only refused.
- ui-flaky-count.sh counts a UI job skipped by a red uibuild apart (it has no log, so it read as "no log yet").
- The test compares the two xcodebuild lines' arguments whole (a control adds one argument), checks the checksum gate.
- EndPull on this Mac, measured: the shared-build half failed the same 2 checks as the full run; the built half pending.

## Round 4 (sonnet): no blocker, no warning; nits applied
- A test RUNS the unpack step (its run block taken from ios.yml) for a good download, a bad checksum, a cut-short tar
  and none: only the good one unpacks, the rest warn and leave the folder empty (mutation: drop the checksum, red).
- --products uses the products only when they hold exactly one .xctestrun (several test plans would make it a guess).
- The new argument arms sit above the comment that belongs to -h; the flaky counter's skipped line says "did not succeed".

## Round 5 (opus, final, whole branch): no blocker; fixes applied
- Products from another commit, an unknown one, or with uncommitted changes under ios/ are NOT used: the app is built
  here (a by-hand run could otherwise pass on yesterday's app). CI never takes it (one commit per run).
- Both fallbacks say ::warning:: on GitHub, so a runner-image split that makes every UI job rebuild is visible.
- A failed upload no longer turns uibuild red (continue-on-error); the UI jobs then build for themselves, warning.
- Test: the two xcodebuild lines are read through every continuation line; the control now mutates the script text and
  shows the comparison fails; both UI jobs' unpack blocks must be identical; the step runs under bash -e as on GitHub.
- Header: names uibuild's --build-only, and that a --products folder is never deleted.
- Card stays open after merge: this change cuts macOS job-minutes; whether queued-to-started and created-to-UI-verdict
  improve is measured on the first runs after merge (the card's actual ask), and reported there.
Loop: 5 rounds, opus/sonnet alternating; round 4 had no blocker or warning, round 5 (whole branch) no blocker.
