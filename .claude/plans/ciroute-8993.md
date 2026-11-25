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
