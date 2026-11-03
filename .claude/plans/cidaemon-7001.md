# cidaemon-7001: run a CI runner as a LaunchDaemon, so a logout or a WindowServer crash cannot take it down

Card: kosmos#7001 (root cause in comment 6613645597).

## Why
On 2026-11-03 at 13:09:10 the old Agent1s Mac's single WindowServer crashed. loginwindow logged out every GUI
session ("Window Server exited, closing down the session immediately"), and runner 1's LaunchAgent was removed with its
`gui/502` domain. A LaunchAgent cannot outlive its session, so the KeepAlive from #7043 cannot bring it back, and over
ssh nobody can load it again (kickstart or bootstrap into gui/<uid> exits 125). A LaunchDaemon in the system domain,
with `UserName` set to the runner's user, belongs to no session.

## Call
A new stage in `tools/ci-runner-setup.sh`, `daemon`, dry run by default like every other stage.
- **Who:** `--apply` runs as root (`sudo` by the machine owner). A dry run runs as root or as the CI user and only reads; as anyone else it reads nothing and exits 3 (the CI user's home and its processes' argv are its own). The runner
  user comes from `KOSMOS_CI_USER` (default kosmos-ci), and `KOSMOS_CI_RUNNER_NAME` is required for a second runner,
  exactly as the keepalive stage takes them.
- **The daemon plist** at `/Library/LaunchDaemons/<the LaunchAgent's label>.plist`, root:wheel 0644. It is WRITTEN WHOLE by the stage, never copied from the
  LaunchAgent (a job can write that home, and root would load whatever a job planted: GroupName wheel, Program,
  MachServices, Sockets, RootDirectory). The keys are svc.sh template's own (Label, ProgramArguments [runsvc.sh],
  WorkingDirectory, SessionCreate, ProcessType Interactive, Nice 15, ACTIONS_RUNNER_SVC), plus `UserName` and `GroupName` (the user's primary group), `HOME` and `USER` in its environment (a
  daemon is not given them), `RunAtLoad`, and the same `KeepAlive {SuccessfulExit: false}`, `ThrottleInterval 10` and
  `ExitTimeOut 35` the keepalive stage sets (they keep their meaning: the runner's own update exits 3 or 4 inside
  runsvc.sh and never ends the job).
- **Allowlist by construction:** "done" means the plist on disk equals the stage's own XML after plutil normalises both,
  and it is root-owned 0644. Any extra key, value or type reads as not this stage's.
- **No StandardOutPath or StandardErrorPath:** launchd opens them for the job, and under the CI user's home a job could
  swap the log dir for a symlink. The runner's own logs are in actions-runner/_diag. (Round 1 asked to check the paths sit
  under ~/Library/Logs; a path check cannot see a later symlink, so dropping the keys is the stronger call.)
- **Refusals, each naming what to do:** the stage refuses while
  - a `Runner.Worker` of that user is running (a job in progress);
  - a `Runner.Listener` of that user runs that is not the daemon's own (a manual `runsvc.sh` start, as on 11-03, or a
    loaded LaunchAgent): a second listener for the same runner would fight it for the session. It names the pids;
  - the LaunchAgent is loaded in `gui/<uid>`;
  - the runner dir or its LaunchAgent plist is not what `svc.sh install` left (the same checks `runner_plist` makes).
- **Apply, in order:** write the daemon plist beside its place and rename it in; move the LaunchAgent plist aside to
  `<plist>.retired-<UTC stamp>` (KEPT, not deleted, so the next login cannot start a second listener and a rollback
  is one `mv`); `launchctl bootstrap system <plist>`; wait for the daemon's job to run a Listener of that user.
- **Rollback, printed by the stage:** `launchctl bootout system/<label>`, remove the daemon plist, move the retired
  LaunchAgent back.

## Rejected
- `KeepAlive` that also covers a clean exit: the job is removed with its domain, so KeepAlive never gets the chance.
- Keeping the user logged in (auto-login, never log out): it does not survive a WindowServer crash, and it is a desktop
  session nobody needs.
- Deleting the LaunchAgent plist: Baron's point (11-03, m2639), keep it until one job has passed under the daemon.

## Keychain (Baron, m2639)
A process with no login session cannot read the login keychain. Measured on main: the only job these runners take
is test.yml's node part, and test.yml has no `security` or keychain step. In the code, only engine/loginexpiry.js
runs `security find-generic-password`, through a 5 s bounded call that fails soft to null, and neither runner user
holds a Claude credential. So a daemon gets the same null a session gets today.

## Weakest premise
That `runsvc.sh` and the Listener behave the same with no login session. GitHub's runner is documented to run as a
LaunchAgent on macOS; a daemon is outside its supported install. What would change my mind: a job failing under the
daemon that passes under the agent. That is why the LaunchAgent is kept aside until one job has passed.

## Not done here
The apply. It needs root on the runner Mac, and the admin `agent1` on the old Mac needs a password for sudo that no
credential in the secrets map gives. It is one command for whoever has root:
`sudo KOSMOS_CI_USER=<user> [KOSMOS_CI_RUNNER_NAME=<name>] tools/ci-runner-setup.sh --apply daemon`.

## Challenge round 1 (opus), fixed in the next commit
- BLOCKER: the daemon was a `cp` of the job-writable LaunchAgent, loaded as root. Now written whole and compared exactly
  (above). Test arm: a planted GroupName wheel, Program and MachServices in the agent do not reach the daemon.
- BLOCKER: GroupName was planned and never written. Now `id -gn` of the CI user; refused when it is wheel or admin.
- Also refused now: the label disabled in system (checked before anything moves), an unreadable print-disabled, a CI
  user that is root, a daemon plist not root-owned 0644.
- Between the first write and the bootstrap, HUP INT TERM PIPE are ignored, and right before the bootstrap the agent
  and the Listeners are read again: a login in that window puts everything back and refuses.
- The wait needs a Listener under the daemon's pid that is still there 3 s later; pgrep exit 2 or more fails loud.
- Every rollback line names the exact retired file and uses sudo; a failed bootstrap says the runner stays down until
  a console login. A loaded daemon with no Listener says "run again in a minute", and only the agent plist back says
  "move it aside", neither suggesting a bootout.
- The test's pgrep stand-in now matches the passed pattern against a process table and honours -u (the relay's
  Listener, and one of this path under another uid, are always in it).

## Challenge round 2 (sonnet), fixed in the next commit
- verify and keepalive did not know the daemon: after it, verify reported a missing LaunchAgent and told the operator
  to run keepalive, which refused with "register first". verify now reads the daemon plist (world-readable) and checks
  its KeepAlive; keepalive refuses saying the runner runs as a daemon. The verify branch has no arm in the daemon test
  (verify needs gh and the owner's view); it is three lines over keepalive_set, which test-ci-runner-setup-4601 covers.
- The agent is now moved aside BEFORE the daemon plist appears at its path, so a power cut between the two cannot leave
  both for the next boot and login to load. A retired name that already exists (a job can write that dir) refuses.
- On the load-only path, a late agent or Listener refuses saying the daemon plist stays and loads at the next boot.
- New arms: a Listener in the window, a taken retired name, the move order, the load-only late refusal, keepalive
  after the daemon. Four perturbations, each red.
- Not changed: KOSMOS_CI_DAEMON_DIR is honoured as root. sudo scrubs the environment unless the operator passes it on
  purpose, and the seam only redirects where root writes a plist it built itself; refusing it would need the real uid,
  which the test stubs. launchctl print system/<label> and print-disabled system were measured to work as a non-root
  user (rc 0, 2026-11-03), so a dry run as the CI user can read them.
