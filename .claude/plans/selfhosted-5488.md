# #5488 part b: route test.yml's macOS suite to the self-hosted Mac, behind a kill switch, never for fork code

## Why
An interim self-hosted Mac (an M4 mini, user `kosmos-ci`) is being set up until the new Mac lands on Nov 4. It
runs the macOS suite outside GitHub's 5-job hosted cap. Stacked on part a (#5490), which adds the `scope` job.

## The change (test.yml)
- `scope` outputs `mac_runner`. It is `["self-hosted","macOS","arm64","kosmos-ci"]` only when the repo variable
  `KOSMOS_CI_RUNNER` is exactly `on` AND the code is this repo's own: a push to main, or a pull_request whose
  head repo equals `github.repository`. Anything else, including the variable unset, gives `"macos-latest"`.
- `suite` uses `runs-on: ${{ fromJSON(needs.scope.outputs.mac_runner || '"macos-latest"') }}`, so a failed or
  timed-out scope job (which still runs the suite) runs it on GitHub's Mac.
- The tmux step is `command -v tmux || brew install tmux`: the runner user may not own Homebrew; tmux is installed
  on the Mac once.
- `scope` and `test` stay on ubuntu. browser-checks.yml and ios.yml are untouched.

## Safety
- The repo is public. Fork code never reaches the Mac, by two layers:
  - fork PR workflows need approval for all outside contributors (set 10-07 11:33 via the API; it was
    first_time_contributors);
  - the head-repo check routes a fork PR to macos-latest even once approved.
- `test.yml` holds no secrets (`contents: read`).
- Same-repo pushers are trusted; they can already edit workflows.

## Merging before the Mac exists is a no-op
With `KOSMOS_CI_RUNNER` unset, every run routes to macos-latest, exactly as today. The variable is also the kill
switch. GitHub has no fallback between runner kinds, so a Mac that is off would hold every routed job until the
variable is set to anything but `on`.

## Tests
`tools/test-ci-runner-route-5488.sh` (in test:shell):
- It runs the REAL decide step body, taken from the parsed workflow, under `bash -e` as GitHub does, for each input:
  - the switch on, unset, off, `On` or `true`;
  - a push, a same-repo PR, a fork PR, a PR with no head repo, or another event.
- It pins the wiring (vars, head repo, runs-on fallback, ubuntu for scope and test, the tmux step).
- It checks both outputs are valid JSON for fromJSON.

Measured red: with the head-repo check removed, the fork case fails.

## The machine (not in this diff; on the card)
- One runner instance first (ports, tmux sockets and /tmp are shared between concurrent jobs on one machine).
- A LaunchAgent under `kosmos-ci`, and a job-completed hook that ends stray processes.
- Labels `self-hosted, macOS, arm64, kosmos-ci`.

## Weakest premise
That the suite run on a persistent machine behaves as on a fresh VM. Leftover boards, tmux servers or files from a
previous job could make a run differ. The cleanup hook and a first measured run on the Mac are the checks.
