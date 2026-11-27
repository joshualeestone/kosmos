# iosci-9213: the iOS logic job stops being cancelled at 40 minutes

Card: kosmos#9213. Finished means: the "logic tests + simulator build" job finishes on a slow hosted runner instead of being cancelled at its limit, with every logic suite still run and passing.

## Findings (measured 2026-11-27)
- Last 60 ios.yml runs (11-25 03:59 to 11-27 07:44 UTC): "Push bridge logic tests" is 200-290 s or 520-810 s, same image (macos-26-arm64) and Xcode 26.6. Job: 17-22 min fast runner, 31-40 min slow. Every 40-min cancel is a slow-runner job. Not a regression from one commit (#9111 adds ~5 s locally).
- Locally the push bridge suite runs in 3 s; compile is ~80 s at -O, 52 s at -Onone, 2793/2793 either way. Type-checking is not the cost.

## Change
1. ios/LogicTests/run*.sh: `swiftc -O` to `swiftc -Onone` (22 lines, 21 files).
2. .github/workflows/ios.yml: build job `timeout-minutes` 40 to 55, with the reason.

## Rejected
- Split the job: two machine setups per push for the same work.
- Raise the limit only: keeps paying the optimizer on every push.

## Weakest premise
Logic tests gain nothing from the optimizer. An optimizer-only behaviour difference would no longer be caught by these suites; the Release build and device archive still compile the optimized app every run.

## Verification
- Every run*.sh before (origin/main, -O) and after (-Onone): same verdicts, times recorded in the PR.
- CI on the PR: the job's duration and the push bridge step time.
- The local saving (80 s to 52 s) is from this Mac only. Where a slow runner's 520-810 s goes is not measured. Read the "Push bridge logic tests" step on the PR's CI runs and after merge: if on a slow runner (its "Simulator SDK build" step takes about 185 s, against about 83 s on a fast one) the step does not drop from its 520-810 s range, the -Onone half did not help there, so revert it and keep the 55 limit.
- The PR body records the before/after verdicts and local times for every run*.sh.
