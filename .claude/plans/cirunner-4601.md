# cirunner-4601: the setup script that makes Agent1s the self-hosted CI runner (#4601)

Plan on the card: kosmos#4601 comment 6165020833. Source runbook: kosmos#5488 comment 6154688503, part 2.

## What
- `tools/ci-runner-setup.sh`: Baron's `ci-mini-setup.sh` (#5488 part b) generalised and moved into the repo. Stages
  preflight, create-user, install, register, verify, machine-settings. DRY RUN BY DEFAULT: a change either goes
  through `act` (which prints `WOULD:` unless `--apply` is given) or sits after a stage's own dry-run return
  (install, register).
- `tools/test-ci-runner-setup-4601.sh`, registered in `test:shell`: stubs on PATH for every changing command and
  every machine read, a sandbox HOME, and a CONTROL per stage with `--apply` that must reach the stubs.

## Decisions
- In the repo, not `~/.cache/claude-handoffs/baron-jobs/`: reviewed, on main on migration day, not tied to the
  home folder that is leaving.
- The suite lock: the run markers are per-HOME, but the name arm (`pgrep -fl`, no `-u`) sees any user's
  run-tests.sh. So nothing new is needed except that no `KOSMOS_` variable is set in the runner's `.env`; install
  refuses one. Residual recorded on the card, not changed: queue wait 105 min against the CI job's 45-min timeout.
- `KOSMOS_CI_RUNNER` is read, never written. `KOSMOS_CI_SHELL_SHARDS` refuses preflight and verify when it names a
  shard test.yml would route (1/2 or 2/2); any other value, empty included, routes none and is reported as such.
- The registration token comes on stdin and reaches config.sh as `ACTIONS_RUNNER_INPUT_TOKEN`, never argv.
  Weakest premise: that the runner honours that variable (from the runner's source as I remember it, not measured
  on a runner here). If it does not, `register --apply` fails at config.sh asking for a token, which is loud.
- The runner package is trusted on first fetch: checked against the sha256 its own release publishes, which
  catches a damaged download, not a compromised release (as Baron's script had it). The guard is pinned harder.
- Auto-login stays a printed System Settings step: the CLI form needs the password in argv.

## Not in scope
Part 1 (returning the mini) and part 3 (migration). Nothing is run on Agent1s with --apply until migration day.

## Proof
- Test: 77 ok. Forty-two mutations each red at the case meant to catch it (act always runs, no .env refusal, -admin,
  token in argv, no suite check, dry install downloads; then no app-label filter, unchecked launchctl,
  no autorestart check, no HOME check; then no Runner.Worker check, no stop re-check, .env read error
  swallowed, late --apply accepted, no busy re-read; then no ERE check on the allow list, no created-user
  check, no restart trap after a stop, the runner dir taken from HOME; then a failed restart unreported, the
  package left behind; then an API failure read as a race, labels unguarded, export KOSMOS_ missed; then an
  empty variable read as unset, any value refused; then the runner's own node counted as a leftover, verify
  blind to .env, a false 'no jobs' line, register before install; then .path not written, .path unchecked;
  then an allow list that clears every job, pgrep and crontab failures read as none, .env mode dropped; then a
  failed Runner.Worker pgrep read as idle, any gh error read as unset; then the package sha check removed, a bare
  `launchctl list`, the services block unbounded; then a retitled `tmux: server` missed).
- preflight reads `launchctl print gui/<uid>`, not `launchctl list`: a bare list reads the caller's session, which
  over ssh is not the owner's GUI. Measured 05:10 on Agent1s from a tmux pane whose session is Background: both
  forms give the same 72 non-Apple jobs, so `launchctl managername` cannot gate it.
- Deferred: the compare API is unauthenticated (60 an hour). It refuses, naming a possible rate limit, and a bearer
  token would sit in curl's argv.
- Deferred: job-completed.sh empties _work/_temp after JOB_COMPLETED. Baron's hook, unchanged, and the mini has run
  jobs with it since 10-07; not re-measured against the runner source here.
- Deferred: anonymous launchd labels (0x..., [..]) as false refusals. 0 of 72 such labels on Agent1s at 05:04,
  the failure is a refusal, and KOSMOS_CI_ALLOW_JOBS covers it.
- The jobs' PATH lives in two files: `.env`, and `.path`, which config.sh's env.sh fills from the login shell and
  runsvc.sh exports (actions/runner source). Which wins for a job was not settled from source, so register writes
  .path to the same value after config.sh and verify checks they agree.
- The runner's service host is node (actions/runner runsvc.sh runs externals/node24/bin/node RunnerService.js),
  so verify reads `ps -o args` and excludes RunnerService.js. The cleanup hook's `pkill -x node` does not reach it
  because it is the hook's ancestor and macOS pkill skips ancestors without -a; that is why the mini stays online.
- Live dry run on Agent1s, 04:27 CDT: preflight refuses on exactly the three step-0 conditions (72 launchd jobs,
  crontab, live suites) and passes every machine check, autorestart included; verify against kosmos-ci-mini is
  clear on the API rows. The runbook's 81 counts the owner's open GUI apps too (`application.*` labels, 9 here),
  which preflight now ignores, since they are not jobs and Terminal is always one of them.
