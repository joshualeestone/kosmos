# daemondir-8404: the daemon stage can make another runner of the same user a LaunchDaemon (kosmos#8404)

## Why
Mortals' three CI runners and its board are LaunchAgents under mortalkombat. When that GUI session ended on
2026-11-11 13:05, all of them stopped (#4402). `tools/ci-runner-setup.sh daemon` (#7001) already writes a proper
LaunchDaemon, but only for `$CI_HOME/actions-runner` and only for joshualeestone/kosmos. A user with more than one
runner (Mortals has three; the old CI Mac has the relay's beside this repo's) cannot make the others daemons.

## Change
- `KOSMOS_CI_REPO` (owner/name, validated) and `KOSMOS_CI_RUNNER_DIR` (one directory directly in the CI home,
  validated) name another installed runner, with its `KOSMOS_CI_RUNNER_NAME`. Set both with the runner's `KOSMOS_CI_RUNNER_NAME`, or neither (a name alone is the existing knob), checked before any of their values is used, the stage first: every stage but daemon, known or not, is told to unset them. They set the
  runner's label (`runner_label`) and RUNNER_DIR (which must be a real directory, not a symlink), which every listener and worker match is already anchored
  on. The daemon stage never asks the runners API (it reads processes), so nothing there changes.
- REPO itself (this script's code, its job guard, its variables, the registration URL) never changes.
- Only the daemon stage takes them. Every other stage refuses them: install and register fetch this repo's guard and use
  this repo's labels; preflight and verify read this repo's variables. verify asks this repo's runners API (`jq_row`,
  `runner_busy`); keepalive checks this repo's label (`want_label`), so it refuses too until that moves to RUNNER_REPO,
  with a test.

## Not in this change
- Mortals' runner user, mortalkombat, is an admin, and the daemon stage refuses an admin user on purpose (a daemon
  gets every group its user is in). The operator step on Mortals is: create a standard user, register the runners
  under it, then one `sudo ... --apply daemon` per runner. That needs an admin password and is not code.
- The cron stopgap on Mortals (#4402) is machine-local, not in the repo.
- Review 5 (read and confirmed in the code): this repo's job cleanup hook, installed only on a kosmos runner, spares
  only `actions-runner-relay` and ends every other node and tmux of the user, which includes a third runner's
  RunnerService.js. Mortals has no kosmos runner, so it does not bite there today. It would if a kosmos runner shared a
  user with any runner besides the relay's. That is stated with the operator steps on #8404, not changed here.

## Weakest premise
That anchoring every match on RUNNER_DIR is enough to keep two runners of one user apart. It is how the relay's
runner is already told apart from this one (#6245), and the new arms check it both ways.
