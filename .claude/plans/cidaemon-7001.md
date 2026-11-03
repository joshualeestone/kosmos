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
- **Who:** `--apply` runs as root (`sudo` by the machine owner). A dry run runs as anyone and only reads. The runner
  user comes from `KOSMOS_CI_USER` (default kosmos-ci), and `KOSMOS_CI_RUNNER_NAME` is required for a second runner,
  exactly as the keepalive stage takes them.
- **The daemon plist** at `/Library/LaunchDaemons/<the LaunchAgent's label>.plist`, root:wheel 0644. It is built from
  the installed LaunchAgent's own plist (its ProgramArguments, WorkingDirectory, EnvironmentVariables, StandardOut and
  StandardError), plus `UserName` and `GroupName` (the user's primary group), `HOME` and `USER` in its environment (a
  daemon is not given them), `RunAtLoad`, and the same `KeepAlive {SuccessfulExit: false}`, `ThrottleInterval 10` and
  `ExitTimeOut 35` the keepalive stage sets (they keep their meaning: the runner's own update exits 3 or 4 inside
  runsvc.sh and never ends the job).
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
