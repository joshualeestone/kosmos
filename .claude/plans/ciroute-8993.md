# ciroute-8993: the iPhone logic build may run on the repo's self-hosted Mac (kosmos#8993)

Finished means: when the repo variable KOSMOS_CI_IOS_JOBS names "build" (and test.yml's kill switch KOSMOS_CI_RUNNER is
`on`), ios.yml's `build` job (logic tests + simulator build) runs on the self-hosted kosmos-ci Mac for this repo's own
code, so an iPhone run asks GitHub's hosted macOS pool for three jobs, not four. With the variable unset, nothing
changes. Measured afterwards: queued-to-verdict on main, against the table on #8993.

## Measured (11-24, 20:2x CST)
- Every queued job was a macos-latest job (ios ui build and uikit, test.yml's suite (shell macOS)); a main ios run
  created 17:35 started its jobs about 20:16.
- The two self-hosted runners (kosmos-ci-agent1s, kosmos-ci-agent1s-2, labels self-hosted,macOS,ARM64,kosmos-ci) were
  online and idle. test.yml already routes there (#5488, KOSMOS_CI_RUNNER=on); ios.yml never did.
- The build job installs nothing, uses no sudo, launchd or home-folder paths; its outputs go to RUNNER_TEMP except
  Xcode's default DerivedData, keyed on the runner's stable work path (one folder reused, not one per run).

## Built
- ios.yml: a `route` job on ubuntu (5 min cap) decides build's runner from KOSMOS_CI_IOS_JOBS, KOSMOS_CI_RUNNER and the
  own-code rule, through env (nothing pasted into the script); `build` needs it and takes its choice. The toolchain
  step prints the runner's name. uibuild, ui and uikit stay on macos-latest.
- tools/test-ci-ios-route-8993.sh (in test:shell): parses the workflow, pins the wiring, runs the real decide body for
  15 inputs (own push and PR, fork, no head repo, each switch off or misspelled, token rules, a glob, another event,
  shell syntax in the list) plus a control. Mutation (always route) turns 6 cases red.

## Rejected
- Routing the UI jobs: they share one build, a UI job whose Xcode differs from the build's builds again, and two
  simulator runs on one Mac under one user share its simulators (#4601's note). Measure build first.
- Folding the uikit shards: only reshuffles the same hosted slots.
- Routing with no switch of its own: KOSMOS_CI_RUNNER alone would move it the moment this merges, unmeasured.

## Not known until it runs
Whether the self-hosted Mac has an Xcode and SDK that build this app, and how long `build` takes there. The PR's own run
answers it once KOSMOS_CI_IOS_JOBS=build is set (main's ios.yml does not read the variable, so setting it touches only
this branch's runs until merge). If that run is red for a machine reason, the variable is unset before merge.

## Weakest premise
That the self-hosted Mac has room: two runners on one box, and test.yml's node part already uses them. A 20 to 30 min
build per iPhone run there could make test.yml wait. Measured after merge; unsetting the variable undoes it.

## Round 1 (opus, blind) fixes
- WARNING fixed: the test could not fail for two rules it claimed. Without set -f the glob case still passed (an empty
  folder), and without the comma split the list case still passed (it had a space). Now a file named build sits where
  the body runs for the glob case, and a comma list with no space is a case; both mutations turn it red.
- WARNING fixed (documented): "Re-run failed jobs" keeps the route a run already had, so a kill-switch change needs
  "Re-run all jobs"; a routed job with no runner waits up to 24 hours, as test.yml's does. Both are in the comment.
- WARNING fixed: a self-hosted preflight step (only there) checks xcodebuild -version, -checkFirstLaunchStatus and an
  iOS simulator runtime, and says in one line which variable to change; nothing else checked these on that Mac.
- WARNING fixed: the archive step's build state goes to RUNNER_TEMP (-derivedDataPath), so a reused DerivedData on the
  self-hosted Mac cannot make it an incremental build. The plan's DerivedData residual is gone for that step.
- NIT fixed: if route fails, build still runs (if: !cancelled()) on macos-latest (fromJSON with a fallback).
- NIT fixed: the comment no longer says "one user"; it says both runners are on one machine (#4601's note).
- NIT fixed: the control now runs a never-routing body and requires all three self-hosted cases to come out wrong.
