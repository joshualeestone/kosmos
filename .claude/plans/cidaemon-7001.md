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
  - the runner dir or its LaunchAgent plist is not what `svc.sh install` left (the same checks `runner_plist` makes);
  - the label is disabled in the system domain, or print-disabled cannot be read;
  - the retired dir exists and is not root:wheel 0700, or a symlink sits on the agent's path;
  - the CI user is root, or its primary group is wheel or admin.
- **Apply, in order:** write the daemon plist beside its place (`<plist>.new`, root:wheel 0644); move the LaunchAgent
  plist into `/var/db/kosmos-ci-retired/<label>.plist.retired-<UTC stamp>` (a root:wheel 0700 dir the stage makes;
  KEPT, not deleted, so the next login cannot start a second listener and a rollback is one `mv`); only then rename
  the daemon plist in; read the agent and the Listeners again; `launchctl bootstrap system <plist>`; wait for a
  Listener under the daemon's pid that is still there 3 s later. Signals are ignored from the first write to the
  bootstrap.
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

## Challenge round 3 (opus), fixed in the next commit
- BLOCKER: on the load-only path the retired file's name came from a glob in ~/Library/LaunchAgents, which a job can
  write, and was printed unescaped into the sudo rollback lines (a planted `...retired-Zz;id;#` sorted last and was
  printed; pasting it runs the planted command). The retired agent now goes to RETIRED_DIR, /var/db/kosmos-ci-retired,
  made root:wheel 0700 by the stage and refused when it is anything else, and only a regular, non-symlink file whose
  suffix is exactly a UTC stamp is ever named. This also settles the round-3 warning that launchd's login scan might
  still load a `.plist.retired-*` left in LaunchAgents: nothing is left there.
- Root no longer moves through a symlink: the stage refuses when ~/Library, ~/Library/LaunchAgents or the agent is one.
  A race between that check and the mv remains; jobs are not running then (the stage refuses on a Worker) and the
  file moved has a fixed name, so it is accepted.
- A failed bootstrap no longer says a login restarts the runner (the agent is moved aside); it says launchd tries
  the daemon plist at the next boot. A pgrep failure after the bootstrap prints the rollback. The wait counts the 3 s
  re-check. daemon_set checks the group too (root:wheel, as the messages say).
- test-ci-runner-setup-4601 sets KOSMOS_CI_DAEMON_DIR to an empty temp dir, so its verify and keepalive arms never
  read the host's /Library/LaunchDaemons.
- New arms: planted names, a directory and a symlink in the retired dir; a retired dir of the wrong mode; a
  symlinked LaunchAgents; a Listener not under a running daemon; a loaded daemon with a foreign plist; primary group
  admin; uid 0; pgrep failing after the bootstrap. Nine perturbations, each red. The stat stand-in always reports
  group 0, so the group half of that check has no arm of its own.
- Not changed: no StandardOutPath. A log in a root-owned dir depends on whether launchd opens it as root or as the
  user, which is unmeasured; the failure message now says where to look instead (_diag, and launchctl print).

## Challenge round 4 (sonnet), fixed in the next commit
- BLOCKER: the new test called a bare `mktemp -d`, which tools/test-mktemp-template-4298.sh refuses (macOS mktemp
  ignores TMPDIR). Templated now; that guard reads 0 failures. I should have run the source-scanning tests before
  pushing a test change.
- The "agent is back" refusal printed a mv beside the agent, in the job-writable dir; it now prints a mv into the
  root-owned retired dir.
- A run stopped after parking the agent (no agent, no daemon plist) said "register the runner first"; it now names
  the parked file and says to put it back and run again.
- A dry run as the CI user cannot look inside the root-only retired dir and now says so instead of "none found".
  Measured as a non-root user on this Mac (2026-11-03): launchctl print system/<label> shows state and pid, so the
  CI user's dry run does see a running daemon.
- verify reports a problem when the daemon plist and the LaunchAgent are both there (no arm: verify is owner-run and
  needs gh; the line is one -e test).
- Header: run the stage as root from the owner's checkout or a root-owned copy, never from a copy in the CI user's
  home; KOSMOS_CI_RETIRED_DIR named as a seam. A failed bootstrap also says that running the stage again only loads.
- New arms: a failed write of the daemon plist puts the agent back; the stopped-half-way state. Three perturbations,
  each red.
- Not changed: daemon_xml and daemon_content_ok read label and cigroup from daemon's scope, as their comment says;
  daemon is their only caller.

## Challenge round 5 (opus), fixed in the next commit
- BLOCKER: the "agent is back" branch checked only that the agent path exists. A job that points
  ~/Library/LaunchAgents at /Library/LaunchDaemons made "the agent" the daemon plist, and the printed sudo mv would
  have moved the daemon away. Now agent_file_ok (no symlink on the path, a regular file, and not the daemon plist by
  `-ef`, which also catches a hard link) gates every printed and performed move of the agent; otherwise no command is
  printed.
- BLOCKER: a pgrep failure just before the bootstrap said only "refused", while the daemon plist was written and the
  agent parked. It now says so and how to go on (run again) or back.
- Root never writes the agent back into the CI home: the stage's own put-back, and every printed rollback line, is
  `sudo cat <retired> | sudo -u <ci> tee <agent>`, so the CI user writes its own file, and the stage's put-back first
  refuses a symlink on the path.
- The comment on the check-then-mv race now says that relay jobs and leftover processes can run in that window, and
  why the race is accepted.
- A CI user in admin as a supplementary group refuses (a daemon gets every group its user is in), via is_admin.
- Notes: an unloaded wrong daemon plist that gets replaced is said; verify says "has a LaunchDaemon plist", not
  "runs".
- New arms: a symlink onto the daemon dir, a hard link to the daemon plist, a pgrep failure while parked,
  supplementary admin, LaunchAgents swapped for a symlink mid-run, the put-back as the CI user, the replace note.
  Eight perturbations, each red; `-ef` was green until the hard-link arm, because in the symlink arm the path check
  refuses first.

## Challenge round 6 (sonnet), fixed in the next commit
- verify's daemon branch was weak and untested: as the owner the LaunchAgents dir is closed, so its "agent is back"
  check could never fire and it printed ok; and ok needed only KeepAlive keys. Now it holds the plist to daemon_set
  (the stage's exact check), says the agent check is NOT made when it cannot look, and has five arms in
  test-ci-runner-setup-4601 (agent back, ok, closed, not root-owned, an extra key), with stat and `id -gn` stand-ins
  added there.
- The header's "never run it from the CI home" is now enforced for --apply: refused from a copy under the CI home
  (compared by physical path: /var is /private/var, which the first arm caught), owned by the CI user, or group or
  world writable. A dry run from any copy still reads.
- A dry run as the CI user that finds no agent and no daemon plist says it cannot look in the root-only retired dir,
  instead of "register the runner first".
- A loaded daemon with no pid yet (restarting) no longer calls its Listener foreign; daemon_child needs a pid.
- A dangling symlink at the agent's path is not "done".
- Not changed: KOSMOS_CI_*_DIR are printed unquoted (operator-set seams, not reachable by a job); only admin and wheel
  are refused as groups (the two that grant root-equivalent rights on macOS).
- New arms: copy in the CI home, group-writable copy, dry run from a copy, no pid, CI-user halfway, dangling.
  Five perturbations, each red.

## Challenge round 7 (opus), fixed in the next commit
- A failed put-back after a failed plist write printed "could not put back" and then "is back where it was"; now
  one or the other.
- A loaded agent is named before a foreign Listener: under KeepAlive a kill only respawns it, so the fix printed is
  the bootout.
- The test's uids are derived from the runner of the test (CI uid = own + 1000, other = own + 1001), not 501/502:
  as uid 502 every --apply arm refused. SUDO_UID is passed, as sudo does.
- --apply now also refuses a script that is a symlink, or owned by anyone but root or the sudo caller.
- Before root reads .service or the agent, both must be regular files (a FIFO a job put there would hang the read).
- The agent-back hint copies the agent as root and has the CI user remove it, so a path swapped for a symlink before
  the paste cannot make root remove the daemon plist.
- The "replacing" note is only for a plist that is not this stage's; the daemon_xml comment says verify does not
  check the values.
- New arms: agent loaded first, symlinked script, a copy another user owns, a FIFO .service, no false replace note,
  and the put-back contradiction. Four perturbations red; the FIFO guard is not perturbed (without it the read
  blocks forever rather than failing).
- Not done: an arm that the signals are ignored across the write-to-bootstrap window (a trap cannot be observed
  through these stand-ins without racing the run).
