# keepalive-7001: CI runners come back by themselves after a kill (kosmos#7001)

## Why
10-23 15:58 CDT: runner 1 (`kosmos-ci-agent1s`) was SIGKILLed mid-job and stayed offline 29 minutes. Its LaunchAgent,
written by actions/runner's svc.sh, has RunAtLoad and no KeepAlive. launchd's log: "exited due to SIGKILL | sent by
node[50709]" (a short-lived node process of the test suite; which test is not in any log we hold, see the card).

## Change (tools/ci-runner-setup.sh)
- register: right after `./svc.sh install`, add `KeepAlive = { SuccessfulExit = false }` and `ThrottleInterval = 10` to
  the plist it wrote (written beside and renamed in), before `svc.sh start` loads it. No plist: fail before start.
- New stage `keepalive`, as the CI user, over ssh or in its session: add it to an installed runner's plist and reload
  (bootout, wait for it to go, bootstrap, wait for a new Listener), only while idle (no Runner.Worker). Refuses when the
  GUI domain is absent (not logged in), when it cannot list processes, or with no plist. Its dry run says whether
  KeepAlive is set, which is how to check a runner whose ~/Library the owner cannot read. It skips need_user's Aqua
  check (ssh-ok): it names gui/<uid> and never uses svc.sh, and bootstrap over ssh was measured working on the old Mac.
- verify: ok or problem when it can read the plist; a note (no exit-code change) when it cannot. Measured: as agent1,
  /Users/kosmos-ci/Library is mode 700, so verify as the owner normally prints the note.

## Why SuccessfulExit false, not KeepAlive true
RunnerService.js relaunches the listener itself on an update (listener exit 3 or 4), so a self-update never ends the
launchd job. The job exits 0 only when the service stops on purpose (SIGTERM/bootout, or listener exit 0, 1 or 5, the
last a session conflict). So it restarts after a kill or crash and never fights a stop or an update. Measured with a
probe agent on the old Mac: restarted after SIGKILL, left down after exit 0.

## Measured on the real runner (before this PR, by hand, same steps as the stage)
Runner 1 patched and reloaded 22:09Z; whole group SIGKILLed 22:09:48Z; launchd restarted it in under 1 s; GitHub read
offline 22:10:36Z and online 22:12:33Z. The stage's dry run, run on the old Mac as kosmos-ci, reads the live plist as
set and a copy of the original as missing.

## Tests (tools/test-ci-runner-setup-4601.sh)
The svc.sh stub's install writes actions/runner's template (no KeepAlive); launchctl's stub gains bootout, bootstrap and
a per-service print. New cases: register adds KeepAlive and keeps the rest; register with no plist starts nothing; the
keepalive dry run changes nothing; --apply over ssh (managername Background) adds it, boots out before bootstrapping,
and sees a new Listener; refusals for a running job, an unlistable process table, no GUI domain, no plist, the wrong
user; a failed bootstrap says the runner is stopped; verify's note, problem and ok. (`bootout` already counted as a
change on main; the extra alternation I added is redundant and harmless.)
Mutants, each red: register without the add, no job check, keepalive_set always true, no ssh-ok, no bootout.

## Not done here
Runner 2 (kosmos-ci2): needs its password or sudo on the old Mac (parked on the card); then, as kosmos-ci2,
`tools/ci-runner-setup.sh --apply keepalive`. Which test sent the SIGKILL: not in any log we hold.

## Review round 1 (BLOCKER and WARNINGs, all fixed)
- BLOCKER: the plist was the first actions.runner.*.plist in the user's LaunchAgents. The kosmos-relay runner lives under
  the same user on the CI mini (#6245) and its plist sorts first, so keepalive would have patched, reloaded and verified
  the RELAY runner and reported success. The path now comes from the runner's own .service, where svc.sh install
  records it (measured on both boxes). Test fixture: a relay plist that sorts first stays byte-identical.
- The job check is `pgrep -x Runner.Worker`, as install's: after a self-update the Worker runs from bin.<version>, so
  bin/Runner.Worker would miss it (the stub now models that). The check runs last, just before the bootout, after the
  plist edit (which alone harms nothing); the window for a job accepted but not yet in a Worker is written down.
- A runner that is not loaded (stopped on purpose) gets the plist edit and is NOT started.
- A bootout that does not unload in KOSMOS_CI_UNLOAD_WAIT_S (default 30) says the runner is still on the OLD definition
  and does not bootstrap; "STOPPED" is printed only after an unload was seen.
- A dry run as a user who cannot read the runner says so instead of "register first".
- register's failure message names the recovery (`--apply keepalive`); ThrottleInterval 10 is said to be the default.
Mutants red: glob lookup, path-based Worker match, no stopped check, no stuck check, no "cannot read" note.

## Review round 2
- BLOCKER: a rerun after a refused or failed reload saw KeepAlive in the plist and stopped there, while the LOADED job
  had none. The stage now reads the loaded job too: launchd prints KeepAlive {SuccessfulExit: false} as the semaphore
  "successful exit => 0" (measured on runner 1; absent on a job without it). Done means in the plist AND loaded; a
  plist with it under an old job is reloaded. After a reload the stage checks launchd shows it. Cases: the rerun after
  a refused reload reloads; a dry run under an old job is not called done.
- Not loaded, but THIS runner's Listener runs (matched by its own dir, so not the relay's): refused, no second copy.
- verify, which as the owner cannot read the CI user's launchd domain, now says only that the plist has it.
- Exit codes, measured: a runsvc.sh-shaped script exits with its child's status (0 -> 0, 1 -> 1) and 0 on SIGTERM.
  RunnerService.js ends every deliberate stop by draining (exit 0); its only process.exit is the unsupported-platform 1
  at start. So only a crash or kill restarts it; a crash loop is throttled to 10 s and stopped with launchctl bootout.
- The unload wait is validated before anything changes; plutil is in the reads list.
Mutants red: done-on-file-only (rerun and old-job cases), no own-Listener check.

## Review round 3
- A runner that is not loaded is no longer "ok": the stage cannot tell a stop on purpose from a runner it left down
  itself (a bootout that finished after the wait, a failed bootstrap), so --apply says DOWN, exits 1 and names the start
  command; it still never starts it. The stuck-bootout message says it may still be unloading and how to tell.
- After a reload, done needs a new Listener from THIS runner's dir (not any Listener of the user: the relay's can
  respawn meanwhile). The Worker check stays a name match on purpose: a path match could miss a Worker started with a
  relative path and cancel its job; refusing on the relay's job is the safe side, and the message says it may be either.
- The pgrep stub now matches -f patterns against this runner's and the relay's real-shaped argv, so a pattern that
  cannot tell them apart fails a test; a reload that loads no KeepAlive fails a test; loaded_keepalive captures
  launchctl's output before grep (no SIGPIPE shape); the dry run checks the GUI domain; verify's note says which of
  no .service, unreadable .service or closed ~/Library it is; register's recovery names ./svc.sh start too.
- Documented, not changed: a killed Listener's session can outlast the restarted Listener's conflict retries; it then
  exits 5 and stays down (KeepAlive true would instead loop every 10 s on a real stop). The liveness page covers it.
Mutants red: a broadened own-Listener pattern (two sites), no post-reload check, the DOWN path back to ok.

## Review round 4
- A bootout that fails outright, with the job still loaded, now fails at once and says the runner runs on the old
  definition (no 30 s wait blamed on slow unloading). Case and mutant added.
- The post-reload KeepAlive check names the launchd wording it keys on, so a print-format change reads as the check's
  fault, not the runner's; the comment states the measured Listener argv.
- Deferred, a duplicate of round 3's documented residual: the session-conflict gap after a fast restart. A larger
  ThrottleInterval would not help (it throttles only jobs that ran under 10 s).

## Weakest premise
That svc.sh keeps recording the plist path in .service (true of actions/runner today, measured on both boxes; if it
stops, keepalive refuses rather than guessing). Second: that the runner keeps ending the launchd job with exit 0 on
every deliberate stop. If a future runner version
exits non-zero on, say, a session conflict, KeepAlive would restart it into the same conflict every 10 s.
