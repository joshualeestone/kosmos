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
  Settled from source (CommandSettings.cs, read in review): the runner reads every ACTIONS_RUNNER_INPUT_ variable,
  masks it as a secret, and clears it from its environment.
- The runner package is trusted on first fetch: checked against the sha256 its own release publishes, which
  catches a damaged download, not a compromised release (as Baron's script had it). The guard is pinned harder.
- Auto-login stays a printed System Settings step: the CLI form needs the password in argv.

## Not in scope
Part 1 (returning the mini) and part 3 (migration). Nothing is run on Agent1s with --apply until migration day.

## Proof
- Test: 106 ok. Seventy-three mutations each red at the case meant to catch it (act always runs, no .env refusal, -admin,
  token in argv, no suite check, dry install downloads; then no app-label filter, unchecked launchctl,
  no autorestart check, no HOME check; then no Runner.Worker check, no stop re-check, .env read error
  swallowed, late --apply accepted, no busy re-read; then no ERE check on the allow list, no created-user
  check, no restart trap after a stop, the runner dir taken from HOME; then a failed restart unreported, the
  package left behind; then an API failure read as a race, labels unguarded, export KOSMOS_ missed; then an
  empty variable read as unset, any value refused; then the runner's own node counted as a leftover, verify
  blind to .env, a false 'no jobs' line, register before install; then .path not written, .path unchecked;
  then an allow list that clears every job, pgrep and crontab failures read as none, .env mode dropped; then a
  failed Runner.Worker pgrep read as idle, any gh error read as unset; then the package sha check removed, a bare
  `launchctl list`, the services block unbounded; then a retitled `tmux: server` missed; then Apple's own agents
  counted, a 404 trusted without a control, unwired hooks, hook files unchecked, no GUI-session check, df unchecked;
  then gh stderr merged into a value, a .path mismatch a problem again, the admin STOP removed; then runsvc.sh not
  refreshed, no Listener wait, unreadable groups read as standard, and my own intermediate one-liner that skipped
  the admin STOP when is_admin succeeded; then a hidden runner dir read as missing, a duplicate hook key missed;
  then FileVault matched by glob, no Command Line Tools check, an allow list read as a grep option, the old Listener
  taken for a new one, an unchecked guard reported clear, the owner note printed twice; then register without a
  wired guard; then an allow list matching every label, allowed jobs not named, register's hook-file refusal; then
  a probe string a narrow allow list could match, an 'export PATH' line kept by the .env merge; then no
  manageruid check, a partial download kept, register without a Listener wait; then register over an existing
  service).
- install and register --apply also require `launchctl manageruid` to be the caller's uid: `sudo -iu` or `su` from
  the owner's GUI reads Aqua but acts on the owner's session. manageruid measured on Agent1s (501 = id -u); its value
  under sudo -iu is reasoned, not measured.
- register --apply refuses unless .env wires both hooks exactly once and every hook file is executable: a runner
  must never go online on a public repo without its guard.
- verify exits 3, not 0, when it could not make a check (a home it cannot read): whether the job guard is wired is
  what it exists to say.
- After a restart, install waits up to KOSMOS_CI_START_WAIT_S (30) for a Runner.Listener: svc.sh start is a
  launchctl load and succeeds for a service that dies at once. It refreshes ./runsvc.sh from bin/ when the runner
  is a service, as svc.sh install does, since a self-updated runner's versioned dirs are replaced by the unpack.
- Apple ships agents outside com.apple.* (com.openssh.ssh-agent): preflight skips any label whose plist is in
  /System/Library/LaunchAgents. On Agent1s at 05:20 that was the only one, and the count went from 72 to 71.
- install and register --apply refuse unless `launchctl managername` is Aqua: svc.sh reads and drives the caller's
  session. preflight does NOT gate on it, because a tmux pane here reads Background and still sees the GUI domain.
- preflight reads `launchctl print gui/<uid>`, not `launchctl list`: a bare list reads the caller's session, which
  over ssh is not the owner's GUI. Measured 05:10 on Agent1s from a tmux pane whose session is Background: both
  forms give the same 72 non-Apple jobs, so `launchctl managername` cannot gate it.
- Deferred: the compare API is unauthenticated (60 an hour). It refuses, naming a possible rate limit, and a bearer
  token would sit in curl's argv.
- Deferred: job-completed.sh empties _work/_temp after JOB_COMPLETED. Baron's hook, unchanged, and the mini has run
  jobs with it since 10-07; not re-measured against the runner source here.
- Deferred: anonymous launchd labels (0x..., [..]) as false refusals. 0 of 72 such labels on Agent1s at 05:04,
  the failure is a refusal, and KOSMOS_CI_ALLOW_JOBS covers it.
- The jobs' PATH lives in two files: `.env`, and `.path`, which config.sh's env.sh fills from its own shell and
  runsvc.sh exports. Settled from source (Runner.Listener Program.cs LoadAndSetEnv, read 05:23): the Listener sets
  every .env line over the exported environment, so .env wins. register still writes .path to match; verify notes
  a mismatch rather than refusing. The same reader takes the text before "=" as the name, so an `export KOSMOS_`
  line is inert; install refuses it anyway.
- The runner's service host is node (actions/runner runsvc.sh runs externals/node24/bin/node RunnerService.js),
  so verify reads `ps -o args` and excludes RunnerService.js. The cleanup hook's `pkill -x node` does not reach it
  because it is the hook's ancestor and macOS pkill skips ancestors without -a; that is why the mini stays online.
- Live dry run on Agent1s, 04:27 CDT: preflight refuses on exactly the three step-0 conditions (72 launchd jobs,
  crontab, live suites) and passes every machine check, autorestart included; verify against kosmos-ci-mini is
  clear on the API rows. The runbook's 81 counts the owner's open GUI apps too (`application.*` labels, 9 here),
  which preflight now ignores, since they are not jobs and Terminal is always one of them.
- tar over a self-updated runner (bin/externals symlinked to versioned dirs) replaces the symlinks with plain dirs
  of the new release: measured by a reviewer in a sandbox with bsdtar, not by me; the real 2.338.0 tarball lists
  ./bin/ and ./externals/ as directory entries.
