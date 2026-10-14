# cirunner-4601: the setup script that makes Agent1s the self-hosted CI runner (#4601)

Plan on the card: kosmos#4601 comment 6165020833. Source runbook: kosmos#5488 comment 6154688503, part 2.

## What
- `tools/ci-runner-setup.sh`: Baron's `ci-mini-setup.sh` (#5488 part b) generalised and moved into the repo. Stages
  preflight, create-user, install, register, verify, machine-settings. DRY RUN BY DEFAULT: every changing command
  goes through `act`/`act_write`, which print `WOULD:` unless `--apply` is given.
- `tools/test-ci-runner-setup-4601.sh`, registered in `test:shell`: stubs on PATH for every changing command and
  every machine read, a sandbox HOME, and a CONTROL per stage with `--apply` that must reach the stubs.

## Decisions
- In the repo, not `~/.cache/claude-handoffs/baron-jobs/`: reviewed, on main on migration day, not tied to the
  home folder that is leaving.
- The suite lock: the run markers are per-HOME, but the name arm (`pgrep -fl`, no `-u`) sees any user's
  run-tests.sh. So nothing new is needed except that no `KOSMOS_` variable is set in the runner's `.env`; install
  refuses one. Residual recorded on the card, not changed: queue wait 105 min against the CI job's 45-min timeout.
- `KOSMOS_CI_RUNNER` is read, never written. `KOSMOS_CI_SHELL_SHARDS` set refuses preflight and verify.
- The registration token comes on stdin and reaches config.sh as `ACTIONS_RUNNER_INPUT_TOKEN`, never argv.
  Weakest premise: that the runner honours that variable (from the runner's source as I remember it, not measured
  on a runner here). If it does not, `register --apply` fails at config.sh asking for a token, which is loud.
- Auto-login stays a printed System Settings step: the CLI form needs the password in argv.

## Not in scope
Part 1 (returning the mini) and part 3 (migration). Nothing is run on Agent1s with --apply until migration day.

## Proof
- Test: 39 ok. Six mutations each red at the case meant to catch it (act always runs, no .env refusal, -admin,
  token in argv, no suite check, dry install downloads).
- Live dry run on Agent1s 04:50 CDT: preflight refuses on exactly the three step-0 conditions (81 launchd jobs,
  crontab, live suites) and passes every machine check; verify against kosmos-ci-mini is clear on the API rows.
