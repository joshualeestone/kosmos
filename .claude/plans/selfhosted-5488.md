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
   It reads only the RUNNER'S OWN event file at its fixed path, so a variable pointing at a planted or stale file is
   refused. It requires that file to name this repo, so a variable alone cannot claim it. Then it allows only push,
   workflow_dispatch, schedule, and a pull_request whose head repo is this repo. It refuses everything else,
   including pull_request_target and unknown events, and fails closed on a missing or unreadable payload. It
   reads JSON with plutil, which ships with macOS.
   It is installed from a PINNED main commit and verified by sha256 (`ci-mini-setup.sh install <commit> <sha256>`),
   so a later change on main is never adopted silently.
2. **Approval of outside contributors' runs.** The repo setting is now `all_external_contributors` (set 10-07 11:33
   via the API and read back; before that it was `first_time_contributors`). Even
   so, a fork PR that touches `.github/` should not be approved while the switch is on: approval runs the fork's
   workflow file.
3. **`test.yml` holds no secrets** (`contents: read`).

Same-repo pushers are trusted; they can already edit workflows.

**The trust model, decided (review iteration 3):** only this repo's own code may run on the Mac. The guard keeps
everyone else's code from running at all, before any step. It does not defend the machine from a TRUSTED job, and on
a machine where jobs run as the runner's own user nothing can: the runner's config, its binaries and the hooks are
all that user's. An earlier draft proposed a root-owned guard as the fix; review showed the runner's `.env` and
binaries would stay writable, so that step bought no real boundary and was dropped. Same-repo writers are trusted
already (they can edit workflows), and `test.yml` installs no packages, so there is no dependency supply chain for
a trusted job to pull hostile code through. Separating jobs from the runner for real would need a VM per job
(ephemeral macOS VMs), which an M4 with 256 GB cannot hold beside the suite; noted for the Nov 4 Mac.

The guard derives the runner's event path from where it is installed, not from any variable, runs `/bin/bash` with
`PATH=/usr/bin:/bin`, and refuses a payload that is a link.

**Must be checked live on the Mac before the switch goes on** (no test here can reach them):
- A same-repo PR whose workflow sets `env: GITHUB_EVENT_NAME / GITHUB_REPOSITORY / GITHUB_EVENT_PATH` to false
  values: the guard must still see the runner's real values. GitHub documents GITHUB_* as not overridable. (The
  path pin and the payload's repo name already refuse a forged path or a repo variable alone.)
- After a restart of the Mac the runner comes back with no one at the keyboard (automatic login as kosmos-ci;
  FileVault prevents it). `machine-settings` prints the admin-only settings.
- A refused job fails before any step, including a job with `container:` or `services:`.
- A job is refused when the payload names a fork (by hand, with the guard's own test payloads).

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
