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

## Safety: what actually keeps fork code off the Mac
The repo is public, and a pull_request run takes its workflow file FROM THE PR. So a fork can rewrite `runs-on` to
name the label, and test.yml's routing only stops the honest path (review iteration 1's BLOCKER; an earlier draft
claimed otherwise). The boundaries, in order:
1. **The machine's job-started hook, `tools/ci-runner-job-guard.sh`.** It runs before any step, and a non-zero exit
   fails the job. It is installed on the Mac from main, never from a job's checkout, so a fork cannot change it.
   It allows only push, workflow_dispatch, schedule, and a pull_request whose head repo is this repo. It refuses
   everything else, including pull_request_target and unknown events, and it fails closed on a missing or
   unreadable payload. It reads the payload with plutil, which ships with macOS.
2. **Approval of outside contributors' runs.** Set 10-07 11:33 via the API; it was first_time_contributors. Even
   so, a fork PR that touches `.github/` should not be approved while the switch is on: approval runs the fork's
   workflow file.
3. **`test.yml` holds no secrets** (`contents: read`).

Same-repo pushers are trusted; they can already edit workflows.

## Cost, stated
- One runner instance: every routed job runs one at a time, three per run. At a burst (three PRs syncing, nine jobs
  of 5 to 12 minutes) that can be slower than the hosted queue. Measure the first day against this morning's hosted
  numbers (p90 188 min); a second instance only after two concurrent shards are shown not to collide.
- With the switch on and the runner offline, routed jobs wait up to 24 hours and nothing goes red. The kill switch
  is the remedy; the runner's online state is checked through the API (it needs the repo admin token).

## Merging before the Mac exists is a no-op
With `KOSMOS_CI_RUNNER` unset, every run routes to macos-latest, exactly as today. The variable is also the kill
switch. GitHub has no fallback between runner kinds, so a Mac that is off would hold every routed job until the
variable is set to anything but `on`.

## Tests
`tools/test-ci-runner-job-guard-5488.sh` (in test:shell): the real guard reading real JSON payloads. It allows a
same-repo pull_request, a push, a manual and a scheduled run; it refuses a fork, a deleted fork, a payload with no
head, a non-JSON or missing payload, pull_request_target, an unknown event, and no event name or repository.
Measured red: with the head comparison removed, both fork cases are allowed.

`tools/test-ci-runner-route-5488.sh` (in test:shell):
- It runs the REAL decide step body, taken from the parsed workflow, under GitHub's own shell flags (`--noprofile --norc -eo pipefail`), for each input:
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
