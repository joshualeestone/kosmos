# keepalive-7001: CI runners come back by themselves after a kill (kosmos#7001)

## Why
10-23 15:58 CDT: runner 1 (`kosmos-ci-agent1s`) was SIGKILLed mid-job and stayed offline 29 minutes. Its LaunchAgent,
written by actions/runner's svc.sh, has RunAtLoad and no KeepAlive. launchd's log: "exited due to SIGKILL | sent by
node[50709]" (a short-lived node process of the test suite; which test is not in any log we hold, see the card).

## Change (tools/ci-runner-setup.sh), as it stands after the review rounds below
- register: right after `./svc.sh install`, add KeepAlive {SuccessfulExit: false}, ThrottleInterval 10 and ExitTimeOut 35
  to the plist .service names (written beside and renamed in), before `svc.sh start` loads it. No plist: fail first.
- New stage `keepalive` (KOSMOS_CI_USER for another runner user), over ssh or in the session. Done = the keys in the
  plist AND in the loaded job (launchctl print) AND the job running. Otherwise --apply adds the keys and, only while no
  Worker of the user runs, reloads: SIGTERM, wait for the old pid (45 s), bootout, wait for unload, bootstrap, wait for
  a new Listener of this runner's own dir, check launchd shows the keys. A runner not loaded is never started (DOWN,
  exit 1). Every failure says whether the runner is on the old definition, DOWN or STOPPED.
- verify: ok/problem when it can read the plist; a note otherwise (it cannot read the CI user's launchd domain).

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
change on main; my extra alternation was removed in round 5.)
Mutants, each red: register without the add, no job check, keepalive_set always true, no ssh-ok, no bootout.

## Not done here
Runner 2 (kosmos-ci2): needs its password or sudo on the old Mac (parked on the card); then, as kosmos-ci2,
`KOSMOS_CI_USER=kosmos-ci2 tools/ci-runner-setup.sh --apply keepalive` (without KOSMOS_CI_USER it refuses: the stage runs as kosmos-ci by default). Which test sent the SIGKILL: not in any log we hold.

## Review round 1 (BLOCKER and WARNINGs, all fixed)
- BLOCKER: the plist was the first actions.runner.*.plist in the user's LaunchAgents. The kosmos-relay runner lives under
  the same user on the CI mini (#6245) and its plist sorts first, so keepalive would have patched, reloaded and verified
  the RELAY runner and reported success. The path now comes from the runner's own .service, where svc.sh install
  records it (measured on both boxes). Test fixture: a relay plist that sorts first stays byte-identical.
- The job check is `pgrep -x Runner.Worker`, as install's: after a self-update the Worker runs from bin.<version>, so
  bin/Runner.Worker would miss it (the stub now models that). The check runs last, just before the bootout, after the
  plist edit (which alone harms nothing); the window for a job accepted but not yet in a Worker is written down.
- A runner that is not loaded (stopped on purpose) gets the plist edit and is NOT started.
- A bootout that does not unload in KOSMOS_CI_UNLOAD_WAIT_S (default 45) says the runner is still on the OLD definition
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

## Review round 5
- My round-4 fail-fast was wrong: launchd can report a bootout error while the job is still shutting down (the Listener
  ends its GitHub session first), so "exited non-zero and still listed" cannot be called "runs on". Reverted: a failed
  bootout waits like any other, and the message carries its exit code and names both outcomes (still on the old
  definition, or DOWN). Mutant: the fail-fast put back turns the case red.
- Done also needs the job RUNNING: KeepAlive loaded on a job that exited 0 (a stop or a session conflict) is DOWN.
- The GUI domain is the CI user's uid, whoever reads it; a missing CI user is a clean refusal.
- Documented: a Listener crash loop is RunnerService.js's to retry, and after its limit it stops (exit 0), so it too
  stays down. Removed my redundant `bootout` alternation from the test's change detector.
- Deferred to the card: the kosmos-relay runners (~/actions-runner-relay on the CI mini, and the relay runner on the
  new Agent1s Mac) also lack KeepAlive. They belong to the relay repo's setup; RUNNER_DIR here is fixed for every stage.

## Review round 6
- Loaded with KeepAlive but not running: re-read for up to KOSMOS_CI_STATE_WAIT_S (12 s, over launchd's 10 s throttle)
  before DOWN, and the message prints the state launchd reports.
- A pgrep failure while noting the running Listener refuses before the bootout (an empty baseline would let any
  Listener count as new).
- The comment says which exit-0 paths were measured (SIGTERM) and which were read from RunnerService.js (0/1/5).
- Not taken, measured false: "svc.sh stop is unload -w, so bootstrap of a stopped runner fails as disabled". svc.sh
  stop is a plain `launchctl unload` (no -w; only start uses load -w), read in the installed svc.sh; noted in a comment.
- .service must name a plist directly in LaunchAgents (no further path).

## Review round 7
- ExitTimeOut 35, added with KeepAlive and required in the plist AND the loaded job (launchctl prints
  `exit timeout = N`). Measured: the installed runner job's exit timeout is 5 s, so launchd SIGKILLs a stopping runner
  5 s after SIGTERM, while RunnerService.js gives the Listener 30 s to end its GitHub session. A stop cut short (a
  reload, any svc.sh stop) leaves the session behind, and the next start meets it: the session-conflict hole. The
  unload wait defaults to 45 s, over the new timeout. Runner 1 was patched by hand before this and lacks it: the
  stage's dry run on it now says "lacks ExitTimeOut 35 (it has KeepAlive)" and would reload it.
- Corrected, read in the installed RunnerService.js: a crashing Listener is retried every 5 s forever (the env limit is
  unset); it is 10 consecutive RETRYABLE exits (2, 3, 4) that stop the service. My round-5 comment had it backwards.
- Tests: the baseline-pgrep refusal, ExitTimeOut written by register, KeepAlive without ExitTimeOut not done and
  completed by --apply, and a loaded job with the old 5 s timeout not done. Mutants red: the plist-side and the
  loaded-side ExitTimeOut requirement.
- Deferred to a card: register and install wait for "any new Runner.Listener" by name, so the relay's could stand in;
  keepalive matches its own dir. Pre-existing.

## Review round 8
- The reload that installs ExitTimeOut used to run under the OLD job's 5 s timeout (runner 1 reads `exit timeout = 5`
  now), so the bootout could cut the session close short itself. The stage now sends SIGTERM (`launchctl kill`) and
  waits up to the unload limit for the old process (its `pid =` line) to end by itself, then boots it out. A clean exit
  0 is not restarted, even by a job that already has KeepAlive. Case and mutant added.
- A dry run that finds the runner not running as it should (not loaded, or its Listener running outside gui/<uid>)
  exits 1, like --apply; a change it would make still exits 0 with WOULD lines.
- The launchctl wording is recorded as measured on macOS 27.0.1 (the old Agent1s Mac, the CI box, and this Mac).

## Review round 9
- `launchctl kill SIGTERM` failing now refuses before anything is stopped. An old runner that outlives the wait is still
  booted out (refusing would leave a SIGTERMed runner under its OLD definition, with nothing to restart it), with a note
  naming the risk and the kickstart to use if it reads offline.
- The wait is tested with a real process the test owns: the stub's bootout records whether that pid was alive. Mutant
  (the wait loop removed) red; before this, the reviewer measured that mutant green.
- Runner 2's command needs KOSMOS_CI_USER=kosmos-ci2 (corrected here, in the usage text and on the card).

## Review round 10
- SIGHUP ignored across the reload (a dropped ssh session must not stop it half way, silently).
- The no-new-Listener failure names kickstart; the dry run's reload note names the launchctl wording it reads.
- Comments: the Listener runs from bin/ even after a self-update (RunnerService.js joins ../bin; the Worker uses
  bin.<version>); the 5 s exit timeout is measured here (Apple documents 20 s).

## Review round 11
- After the SIGTERM step, a stuck bootout says the runner is STOPPED (SIGTERM ended it), not "runs the old definition".
- SIGHUP and SIGPIPE are ignored in the reload window and its message cannot fail the script; the comment names the
  residual (launchctl's own output to a gone terminal) and nohup for sessions that may drop.
- install polls `svc.sh status` after `svc.sh stop` for up to the unload limit (45 s): with ExitTimeOut 35 a stop can
  take up to ~30 s, and a single read would refuse a stop still in progress. (Regression risk this PR introduced.)
- A bootstrap error re-reads launchd before saying STOPPED (it can report an error and still load the job).
- Dry run: a loaded runner without KeepAlive that is not running is named, and the reload is said to start it.
- No pid line for the loaded job: said (no SIGTERM first). Case added: stuck bootout after SIGTERM.

## Review round 12
- No pid in launchd's print while this runner's Listener runs (a print-format change): refuse before stopping
  anything, instead of a bootout under the old exit timeout. Mutant red. The stub prints a pid by default now.
- The CI home is validated to safe characters at the top (it goes into pgrep patterns), and KOSMOS_CI_UNLOAD_WAIT_S
  is validated once there for every stage (install and keepalive agreed on nothing before).
- A source-order test: the HUP/PIPE trap sits after the job check and before the SIGTERM.
- The header says the stage touches this repo's runner only, not a relay runner under the same user.

## Review round 13
- Documented: a SIGTERM or SIGINT to runsvc.sh or node (any kill tool's default signal) is handled as a stop, exits 0
  and is NOT restarted; only a SIGKILL or a crash is (10-23 was a SIGKILL). Decided against KeepAlive true, which would
  restart that too but loop every 10 s on a removed registration (listener exit 1); recorded as a premise below.
- All three waits (UNLOAD 45, START 30, STATE 12) validated at the top; tests for that and for the CI-home check.
- install's stop poll is tested with a stop still in progress (Started for 2 more reads), mutant red. Its premise, that
  `launchctl unload` can return before the job has exited, is not measured; the poll is harmless if it cannot.
- Bootstrap retried up to 3 times, then launchd is re-read. "SIGTERM ended it" only when the pid did not outlive the
  wait. The no-pid refusal names both causes. A higher operator ExitTimeOut is kept. The header lists the waits.

## Review round 14
- install's give-up message says the runner was told to stop and may still be stopping, and names ./svc.sh start
  (asserted). The reload's final ok cannot fail the script after a good reload (|| true, as the window's note).
- Deferred with evidence: "the semaphore wording is unconfirmed". It was measured on runner 1 itself (a real
  KeepAlive job, macOS 27.0.1, 17:48) and found on com.apple.Dock.agent by the round-11 reviewer; the stub cites the
  capture.

## Review round 15
- A disabled override (launchctl print-disabled shows the label => disabled) is refused before anything is stopped,
  naming `launchctl enable`: the bootout would succeed and the bootstrap fail, leaving it stopped. Case and mutant.
- add_keepalive judges an existing ExitTimeOut with the same integer test as keepalive_set (a 3.5 was read as 35, kept,
  and the stage never converged). My first fixture for this used `plutil -insert -real`, which plutil rejects, so the
  case passed vacuously; a mutant run showed it, the fixture now uses -float with a control. Mutant red.
- The post-reload failure says which launchd line is missing (the semaphore, or an exit timeout under 35).
- The bootstrap retry re-reads launchd between tries (an error with the job loaded ends it); a pgrep failure while
  deciding whether the runner runs elsewhere refuses instead of saying DOWN.

## Review round 16
- An interrupt (INT/TERM) in the stop window prints the recovery and exits 130 (tested: the stub's launchctl kill
  sends SIGINT to the script); disarmed once the job is loaded again.
- runner_plist's guards tested: a .service naming a directory like actions.runner.d/ (the name glob spans '/') and a
  non-actions.runner plist are refused. Mutant red.
- An operator's existing KeepAlive is named when replaced; a ThrottleInterval of 10 or more is kept.
- The wait test also asserts the run took most of the 4 s sleep (a pid gone before the loop would read "after exit").
- Deferred: the plan-file naming convention (<branch>-<timestamp>); the branch-named file is what the proof gate reads.

## Review round 17
- The service up with no Listener of this runner (between Listeners: RunnerService.js's 5 s relaunch, or a self-update
  moving bin/) refuses before the SIGTERM, which could end the updater half way. Case and mutant.
- Deferred NITs: print-disabled read fails open (an unreadable list reads as not disabled; the bootstrap failure
  message still names the state); the dry run does not preview a disabled label; a plist missing keys under a loaded
  job that has them is reloaded rather than only written.

## Weakest premise
Fourth: actions/runner's self-update rewrites the RUNNING runsvc.sh in place (`cat bin/runsvc.sh > runsvc.sh`); bash
reads the rest at its old offset when the stop arrives. Safe while the template changes only a same-length line.
Third: that SIGKILL, not SIGTERM, is how a runner gets killed in practice (the 10-23 sender was a SIGKILL); a SIGTERM
leaves it down, by design (KeepAlive true would restart it, at the cost of a 10 s loop on a removed registration).
That svc.sh keeps recording the plist path in .service (true of actions/runner today, measured on both boxes; if it
stops, keepalive refuses rather than guessing). Second: that the runner keeps ending the launchd job with exit 0 on
every deliberate stop. If a future runner version
exits non-zero on, say, a session conflict, KeepAlive would restart it into the same conflict every 10 s.

## Review round 18 (sonnet, blind, HEAD 70f05bbe1c)
- W1 FIXED: verify, home hidden from the caller: the LaunchAgent check fell through to "no .service: not registered".
  It now checks `hidden` first and says it cannot look inside (test on v-home-hidden and v-home-closed; mutant red).
- W2 FIXED: the stage's ok line said "restarts after a kill"; a SIGTERM is a stop and is not restarted. It now says
  "after a SIGKILL or a crash".
- W3 FIXED: no case for --apply on a loaded job that is not running (exited 0). Added ka-loadedstopped: no SIGTERM,
  bootout, bootstrap (mutant that forces a pid: red).
- CONVENTION FIXED: the plan said the unload wait defaults to 30; it is 45. NITs deferred (a print-disabled negative
  fixture is test polish with no behaviour behind it; recorded, not built).

## Review round 19 (opus, blind, HEAD 0f85442f14)
- W1 FIXED: nothing proved register adds KeepAlive BEFORE svc.sh start (the test read the plist afterwards). The svc.sh
  start stub now logs the plist's KeepAlive at start; rg-apply asserts start-ka=false (mutant moving add_keepalive after
  start: red).
- W2 FIXED, MY OWN DEFECT FROM ROUND 18: the "not called unregistered" negative was single-quoted, so $VCI never
  expanded and it could not fail. Now -F in double quotes; a mutant printing the wrong note beside the right one: red.
  The same pass found three more vacuous negatives I left in round 18: ka-oldjob, ka-partial, ka-oldtimeout still
  checked "restarts after a kill", the phrase round 18 renamed. Fixed; a mutant printing the ok phrase in the dry
  run turns all three red. Lesson already in memory (grep every reader of changed wording); I did not run it.
- W3 FIXED: a LOADED KeepAlive true restarts the clean stop the SIGTERM causes, so the bootout could cut a starting
  Listener. MEASURED the print shape on this Mac (throwaway agents, all three variants): true prints
  "properties = keepalive | runatload | inferred program" and no semaphore; the dict prints the semaphore and no keepalive
  property. loaded_always() detects it (tested against the real launchd output under pipefail: true YES, dict no,
  none no); --apply and the dry run both refuse with the by-hand reload. Cases ka-always, ka-always-dry; three mutants red.
- W4 FIXED: the dry run promised a reload --apply refuses for a disabled label. label_disabled() is shared; ka-disabled-dry.
- C5 FIXED: ThrottleInterval was written but never checked. keepalive_set needs >= 10 and keepalive_missing names it
  (ka-throttle, fixture asserted to hold Throttle 1; mutant red).
- C6 FIXED: the CI home check validates "$CI_HOME" itself, not a re-derived expression.
- DEFERRED NITs: 7 (exit 130 on TERM as well as INT: no caller distinguishes them), 8 (a deeper-indented state line in
  the stub), 9 (pid reuse in the new-Listener wait: fails safe), 10 (a stranger who can read the plist is told "not
  logged in": ~/Library is 700).

## Review round 20 (sonnet, blind, HEAD 586ecd819e)
- W1 FIXED: the job check ran once, before the SIGTERM; the wait after it can last the unload limit, and a Listener that
  took a job in it would have the job cancelled by the bootout. The check now runs again at the bootout and refuses
  (saying the runner will end after the job and stay stopped, then rerun). Stub FX_WORKER_AFTER_KILL; ka-jobduring;
  mutant red. The trap-order source check now anchors on the first check's message (it took the last check).
- W2 FIXED: as the owner in production (~/Library 700) verify printed a note and exited clear, so a runner without
  KeepAlive verified clean. Both "cannot see" branches are now UNCHECKED (exit 3); the hidden-home branch stays a note
  because that case is already counted once. Cases ka-library-closed, ka-service-unreadable; two mutants red.
- C3 FIXED: ka-bootoutfail's negative "runs on" is a phrase the script never prints. It now checks "the runner is
  STOPPED" (the text of the post-SIGTERM branch, wrong here); mutant red.
- C4 FIXED: the HUP trap had only a source-order test. Stub FX_HUP sends a real SIGHUP inside the window; ka-hup asserts
  the reload completes (mutant removing the trap: rc 129, red).
- DEFERRED NITs: 5 (130 on TERM), 6 (ka-interrupt is red if the suite runs with SIGINT ignored, e.g. backgrounded; the
  reviewer hit that; documented here, the suite is run in the foreground), 7 (20-digit waits), 8 (cross-user dry run
  message), 9 (dry run as another user), 10 (two concurrent --apply runs: an operator runs it once).

## Review round 21 (opus, blind, HEAD 713b0166cd)
- W1 FIXED: the "new Listener" filter was untested (a mutant counting the old pid passed). Stub FX_BOOTSTRAP_SAME_PID;
  ka-nonew; mutant red.
- W2 FIXED (wording, NOT MEASURED): the job-during-stop refusal promised the runner "ends after that job". The SIGTERM
  becomes SIGINT to the Listener, which (from actions/runner knowledge, not measured) cancels a running job. The
  message now says the job is most likely cancelled too, and to rerun once idle.
- W3 FIXED (doc): verify as the owner on a default Mac ends at 3 by design (~/Library 700); the header says so and names
  the CI user's keepalive dry run as the check. Rejected: a separate exit code (one more contract for a case the header
  now names; reopen if the guard-sha UNCHECKED gets lost in practice).
- W4 FIXED: .service was trusted to name the plist; a job can write this home, and the relay's plist matches the same
  pattern. runner_plist now also needs the plist's WorkingDirectory (svc.sh's template sets it; read on the relay plist
  on this Mac) to be RUNNER_DIR. ka-servicerelay (relay plist untouched); mutant red. RESIDUAL, stated: a job can rewrite
  the relay plist's WorkingDirectory too; a job that can write this home can already break the relay runner, so this
  closes the accidental and simple case, not a determined one.
- C1 FIXED: the dry run now predicts --apply's pid and between-Listeners refusals (ka-nopid-dry, ka-between-dry; mutants red).
- C2 FIXED: keepalive's pgrep uses the CI user's uid, not the caller's. NOT TESTED: the pgrep stub ignores -u.
- C3 FIXED: the measurement comments name the machine one way.
- NIT1 FIXED: a <string> ExitTimeOut/ThrottleInterval is not taken for an integer (ka-strtimeout; mutant red).
- NIT2 FIXED: own_re anchored to the argv start, '.' escaped (stub FX_LOOKALIKE; ka-lookalike; mutant red).
- NIT3 FIXED: a pid change after the SIGTERM (launchd restarted it) refuses before the bootout (ka-respawn; mutant red).
- Test harness: $T no longer has "//" ($PWD collapses it, so svc.sh's WorkingDirectory differed); the pgrep stub
  dispatches on Runner*Listener (the pattern now spells Runner[.]Listener).
- DEFERRED: NIT4 (wait_for_listener by name: follow-up card b), NIT5 (loaded ThrottleInterval is not printed by launchd).

## Review round 22 (sonnet, blind, HEAD ca4c9b5b49)
- W1 FIXED, A REGRESSION I MADE IN ROUND 20: the job check at the bootout ran whenever SIGTERM was sent. Once the old
  runner has ended it has no Listener, so a Worker then is the relay's, and refusing left THIS runner stopped with
  nothing to restart it. The check now runs only when the old runner outlived the wait. ka-jobduring (outlived, refused)
  and ka-relayjob (ended, reload goes on); mutants for both directions red.
- W2 FIXED: the dry run did not predict --apply's busy refusal (ka-busy-dry; mutant red).
- W3 REVERSED MY ROUND-21 CALL: an exit 3 that every owner run shows hides the checks that really could not be made, and
  makes "clear" unreachable. Back to a note, now worded "KeepAlive NOT checked", and the header says verify as the
  owner does not cover KeepAlive (round 20's W2 offered exactly that as its second fix). An unreadable .service stays
  UNCHECKED (unusual, not the default). ka-library-closed expects 0 and the note; mutant red.
- NIT2 already true: the state/pid regexes take ONE leading whitespace character, not [[:space:]]*, so nested lines
  cannot match.
- DEFERRED NITs: 1 (cross-user dry-run wording), 3 (a real-typed key larger than ours is replaced by ours), 4 (ka-waits on
  a very slow host passes rather than fails), 5 (PIPE half of the trap: source order only), 6 (a TMPDIR with a space
  fails the CI-home check in the suite).

## Review round 23 (opus, blind, HEAD 02f7902ca6)
- W1 FIXED, MY OWN GAP FROM ROUND 21: I taught keepalive_set to reject a <string> ExitTimeOut but left add_keepalive
  deciding with raw, so it kept the string: "KeepAlive added", a reload, FAILED, and the same reload on every rerun.
  add_keepalive now decides each key with plist_int_ge and re-checks keepalive_set on the .new before renaming it in.
  The bootstrap stub now ignores a non-integer ExitTimeOut (shows 5), as launchd does. ka-strapply (apply converges, the
  next dry run says done); mutant red.
- W2 FIXED: the Label inside the plist was trusted. It must now equal the plist's own name (svc.sh writes them the
  same), so a Label naming the relay cannot aim the stop at it. ka-labelrelay; mutant red.
- C FIXED: the ka-library-closed comment said "never clear" above an assertion of exit 0.
- NIT FIXED: an unreadable print-disabled is no longer read as "not disabled" (label_disabled returns 2; both paths refuse).
  ka-pdfail; mutant red.
- NIT FIXED: the dry run promises a SIGTERM only when the job has a process (ka-loadedstopped-dry; mutant red).
- DEFERRED: wait_for_listener by name (follow-up card b, pre-existing); the owner's dry run on a Mac where ~/Library is
  opened up reads "not logged in" (non-default; deferred in rounds 19, 20 and 22 too).

## Review round 24 (sonnet, blind, HEAD e84915854e)
- W FIXED: SuccessfulExit was still compared through raw, which prints "false" for <string>false</string> too (launchd
  ignores it): in_file=1, a reload, FAILED, on every run. The same class round 23 fixed for the integers; I fixed the
  instance there, not the class. keepalive_set now requires EXACTLY the dict add_keepalive writes (ka_xml, KA_DICT), which
  also settles C2 (a dict with extra keys was "set" in the file case but replaced in the add case; now replaced, and
  said, in both). The bootstrap stub honours only a typed <false/>. ka-strka (dry run lacks it, --apply converges, next
  run done), ka-extrakey; mutants on keepalive_set and on keepalive_missing both red.
- C3 FIXED: the HUP/PIPE ignore is cleared with INT/TERM once the job is loaded again.
- NIT 6 FIXED: the "Outlives the wait" comment and its sleeper sat above an unrelated case; moved to ka-outlives.
- DEFERRED NITs: 4 (eval of fixed names in the wait check), 5 (CI-home allow-list applies to every stage; documented,
  tested).

## Review round 25 (opus, blind, HEAD ea820ea970)
- W1 FIXED: the job veto while the old runner outlives the wait matched ANY Worker of the user, so a relay job then left
  this SIGTERMed runner stopped. It now matches only a Worker that is a child of this runner's Listener
  (pgrep -P <Listener pids>). The first job check, before anything is stopped, stays user-wide on purpose (refusing
  there costs only a rerun). Stub: -P sees only this runner's job; ka-relayoutlived; mutants (user-wide, none) red.
  WEAKEST PREMISE, NOT YET MEASURED: that Runner.Worker is a direct child of Runner.Listener. If it is a grandchild, -P
  misses this runner's own job and the bootout goes ahead; that job is most likely already cancelled by the SIGTERM.
  A watcher on the relay runner here (agent1) is waiting for a real job to measure the parent. Its first version
  matched a SHELL whose argv mentioned "Runner.Worker" (bulletin pgrep-f-matches-your-own-command-line); rewritten to
  match the comm column, with a control on the live Listener.
- W2 DOCUMENTED, not changed: the keepalive dry run exits 0 both when done and when it would change something; the
  header now says to read the "ok: ... restarts after a SIGKILL or a crash" line, not the exit code. Rejected: a new exit
  code this late, for a check nothing automates today; reopen if something starts to.
- NIT1 FIXED (raised in rounds 19, 20, 22, 23, 25): as any user but the CI user, keepalive says to run it as the CI user
  and reads no launchd (ka-other-readable; mutant red).
- NIT2 FIXED: a trailing / on the CI home is dropped (ka-slash; mutant red; the pgrep stub's argv no longer inherits it).
- NIT3 FIXED: the owner's note says "no LaunchAgent of this runner" and "usually closed".
- NIT4 FIXED: the print stub now has a nested block with its own "state = active" and "pid = 1" BEFORE the job's lines,
  so the one-tab anchors are load-bearing; loosening either the state or the pid anchor turns cases red.
- DEFERRED: NIT5 (install could add KeepAlive before its own restart: scope; the keepalive stage covers it), NIT6
  (register does not check the loaded job: register's start is svc.sh's, verified by the next keepalive dry run).

## Review round 26 (sonnet, blind, HEAD 79a685e2cd)
- W1 FIXED: three printf|sed|head assignments under pipefail had no || true (latent: needs two one-tab matches).
- W2 FIXED: a restart launchd SCHEDULED after the SIGTERM (non-zero exit under a loaded KeepAlive, waiting out the
  throttle) has no pid, so the pid comparison passed and the bootout could cut it. MEASURED on this Mac with a
  throwaway job (exit 1, ThrottleInterval 10): "state = spawn scheduled", no pid line, for the whole throttle. The
  stage now refuses on that state. Stub FX_SPAWN_SCHEDULED_AFTER_KILL; ka-spawnsched; mutant red.
- W3 FIXED: the pgrep stub answered -P without reading the list. It now sees this runner's job only when the -P list
  is this runner's Listener pid; mutants passing an empty list or the runsvc pid are red.
- C (home-character check applies to every stage): kept, and to be NAMED in the PR body as a behaviour change outside
  the stage (the reviewer's first fix). It is tested (top-home).
- NIT2 FIXED: dots in RUNNER_DIR are escaped in own_re.
- NIT1 NOT A DEFECT: the dry run prints "WOULD: add KeepAlive ..." before the loaded-job checks, so a busy refusal
  follows that line (read in the dry-run block).

## Review round 27 (opus, blind, HEAD f515c42905)
- W FIXED: refusing the bootout when this runner's job was up while the old runner outlived the wait left a SIGTERMed
  runner to end with exit 0 under its OLD definition: down, the defect this card is about, and it saved nothing (the
  SIGTERM most likely cancels the job). Now: a note, a second wait (up to the limit) for that job and the old runner
  to end, then the reload in every case ("reloading anyway" when still up). Stub FX_WORKER_ENDS_AFTER; ka-jobduring
  (waits, then reloads), ka-jobends (polls until it ends; >= 3 -P reads); mutants (no wait, the old refusal) red.
- C FIXED (doc): the header now says a dry run also exits 1 with "refused: ... --apply would refuse" when --apply would
  refuse now.
- NIT FIXED: with no process, the failed-bootout message says "still loaded from the OLD definition", not "runs".
  CAUGHT MYSELF this time: ka-stucksent's negative named the old phrase; repointed, and a mutant printing the new phrase
  turns it red. (The grep-every-reader rule, run before review rather than after.)
- NIT FIXED: ka-waits could pass if setup outran the 4 s sleeper. The kill stub now logs whether FX_JOB_PID was alive at
  the SIGTERM; ka-waits needs kill-while-alive AND bootout-after-exit (mutant removing the SIGTERM wait: red).
- NIT FIXED: ka-dry asserts the "WOULD: launchctl kill SIGTERM" line (mutant red).
- DEFERRED NIT: a busy relay can delay this runner's reload (the first job check is user-wide on purpose: refusing there
  stops nothing, and the plist alone covers the next login).

## Review round 28 (sonnet, blind, HEAD d3762689a8)
- W1 FIXED (and with it the follow-up card (b) I had planned, raised in rounds 23, 25 and 28): register and install
  waited for any new Runner.Listener of the user BY NAME, so the relay's respawning Listener could read as this runner
  started. One own_listener_re() (anchored, dots escaped) now serves register, install, wait_for_listener and keepalive.
  The pgrep stub's -x branch now lists the relay's Listener (as a real name match would), its -f branch knows
  FX_OLD_TOO, svc.sh start can respawn the relay (FX_RELAY_RESPAWN_ON_START). rg-relayrespawn; mutant (back to -x) red.
  Three tests read the reworded "no new Runner.Listener of" message; updated (grep of every reader before running).
- W2 FIXED, MEASURED: the loaded ThrottleInterval was never checked. launchd prints it as "minimum runtime = N" (23 in,
  23 out; 10 when unset), so loaded_keepalive now needs it >= 10, and the post-reload FAILED message names both values.
  Stub prints minimum runtime from the plist at bootstrap; ka-oldthrottle; mutant red.
- W3 FIXED: the print stub never modelled the realistic SIGTERM (exit 0: no pid, "not running"). FX_EXIT_AFTER_KILL;
  ka-exited (booted out and reloaded); a mutant refusing on no pid is red.
- NITs FIXED: ka-jobduring's comment said "refused"; a duplicated cleanup line.
- DEFERRED NITs: verify's message when the plist exists but is unreadable (needs an unusual directory permission);
  plist_int_ge on a dict/array holding an integer (hand-mangled plist only); the trap-order test is source order (the
  HUP case sends a real signal).

## Review round 29 (opus, blind, HEAD ab73fac2ef)
- W1 FIXED: verify gave the "cannot see" NOTE even when the owner CAN read ~/Library/LaunchAgents and the plist is
  missing or not this runner's. It now says PROBLEM when that directory is readable and searchable; the note stays for a
  closed ~/Library. ka-plist-missing; mutant red.
- W2 FIXED: ka-relayoutlived passed against the widening it exists to catch (since round 27 a wrongly counted job means
  a wait, not a refusal). It now also asserts no "a job of this runner is still up" and no "reloading anyway"; the
  reviewer's own mutant (user-wide late check) is red now.
- W3 FIXED: changed() cannot see plutil/cp/mv (real binaries), so the dry-run cases could not see a plist write. Seven
  dry-run cases on the untouched fixture now also cmp the plist; a mutant writing it before the APPLY check is red.
- NIT1 FIXED: a loaded print without the measured "exit timeout"/"minimum runtime" lines would make every --apply reload
  and FAIL. It now refuses before writing or stopping anything (ka-noformat; mutant red).
- NIT2 FIXED: dry-run refusals say --apply writes the plist first (ka-writesfirst).
- NIT3: a comment for the re-parented Worker the late check cannot see.
- TO CHECK ON RUNNER 1 BEFORE --apply: that its loaded print has a "minimum runtime" line (the dry run will refuse if
  not, which is the safe direction).

## Review round 30 (sonnet, blind, HEAD 679195e9f8)
- W1 FIXED: the DOWN state wait (12 s) could be shorter than a loaded ThrottleInterval above 10, so a crashed runner
  waiting out a long throttle read as DOWN. The wait is now at least the loaded "minimum runtime" + 5 s.
  ka-longthrottle (10 + 5 = 15 s against a 1 s setting); mutant red.
- W2 FIXED: the restart check after the SIGTERM was ONE read; launchd may show "spawn scheduled" or a new pid a moment
  later. Now three reads a second apart (+2 s per reload). Stub FX_SPAWN_LATE_AFTER_KILL (shown one read late);
  ka-spawnlate; a one-read mutant is red.
- W3: the window between the first job check and the SIGTERM is the accepted one; now named in a comment there.
- NIT on the one-tab anchor: NOT A DEFECT. ^[[:space:]]pid matches exactly ONE whitespace character before "pid", so a
  two-tab nested line cannot match (also settled in round 22). Left.
- DEFERRED NITs: the grep . consistency between two "new Listener" filters (both correct); the orphaned-Worker case
  (comment already says so); children inherit the HUP/PIPE ignore (harmless, guarded).
- MEASUREMENT: the comm-column watcher saw NO relay Worker in 60 min, so "Runner.Worker is a direct child of
  Runner.Listener" stays the unmeasured premise (round 25), stated in the PR.

## Review round 31 (opus, blind, HEAD 23602276f5)
- W1 FIXED, A VACUOUS TEST I WROTE IN ROUND 27: ka-jobends' old-runner stand-in lived through the whole second wait, so
  the early exit could never be taken and "reloading anyway" was printed while the case passed. The stub now ends the
  stand-in when this runner's job ends; the case asserts no "reloading anyway"; a mutant removing the early exit is red.
- W2 FIXED: a Ctrl-C (or TERM) between the SIGTERM and the bootstrap exited 130 and left a runner stopped under a
  definition without KeepAlive: down for good. Once the SIGTERM is sent, INT and TERM are ignored too (said in a note)
  until the job is loaded again. Stub FX_INTERRUPT_LATE (SIGINT during the bootout); ka-intlate; mutant red.
  ka-interrupt (SIGINT during the kill call itself, before it is ignored) still exits 130 with the INTERRUPTED text.
- NIT1 FIXED: the restart check now runs AFTER the second wait (the old runner may end in it, non-zero, under a loaded
  KeepAlive), not before.
- NIT3 FIXED: keepalive as another user exits 3 (a check it could not make), not 0; header says so; ka-other cases updated.
- NIT5 FIXED: the unmeasured-format refusal says "--apply would refuse too".
- NIT6 FIXED: loaded_keepalive reads exit timeout / minimum runtime as one-tab lines; the print stub's nested block now
  holds "exit timeout = 99" and "minimum runtime = 99", so an any-indent read is red.
- DEFERRED: NIT2 (the first job check stays user-wide: -P rests on the unmeasured parent premise, and a refusal there
  stops nothing), NIT4 (unreadable plist in a traversable LaunchAgents: unusual mode), NIT7 (cmp in the modified-fixture
  dry-run cases: the one write site sits after the dry-run return and ka-dry covers it).

## Review round 32 (sonnet, blind, HEAD 548e9fe551): CONVERGED
- 0 BLOCKER, 0 WARNING, 0 CONVENTION. NITs:
  - FIXED (doc/test only): the header said any other user exits 3; true of the dry run only (--apply exits 2 from
    need_user). ka-relayjob was named for a relay job but used this runner's job fixture; now FX_RELAY_WORKER_AFTER_KILL.
  - DEFERRED: INT/TERM ignored only after a SIGTERM was sent (with no process the runner was already down and the
    INTERRUPTED message names the recovery); one variable bounds several waits (the note says "a few minutes"); ka-waits
    could false-FAIL (never false-pass) under heavy load; own_listener_re rests on the measured argv (a change fails
    safe, as a refusal).

## 6j final validation (after round 32): FAILED, fixed
- [BLOCKER] final-validation: tools/test-sleep-control-guard-6710.sh flagged five bare `sleep N &` stand-ins I added
  to test-ci-runner-setup-4601.sh (a stray `pkill -f sleep` on this shared box can end them, #6710/#6671). Converted to
  `perl -e 'select(undef, undef, undef, N)'` bounded waits; the guard passes.
- CAUGHT IN THE FIX: my first conversion put the comment before `; t0=$SECONDS`, commenting it out. The suite then died
  on `t0: unbound variable` AND EXITED 0, with no verdict line. Only checking the verdict line caught it (the rc said
  green). Fixed; the suite prints "all passed" (245 ok).
- Per the loop: one more blind round (33) after the 6j rerun.
- 6j rerun FAILED on tools/test-gnu-only-forms-6808.sh: a message I reworded in round 28 contained "exit timeout $(...)",
  which the check reads as the GNU `timeout` command (a false positive on prose, but the rule is the rule). Reworded to
  "its 'exit timeout' as $(...)"; the check and the suite pass. MY GAP: the handoff said to re-run the sibling suites
  whenever the code changed; I last ran 6808 at round 18 and let 6j find it.
- 6j third run FAILED on one node test, cli.busy-health-4466.test.js ("a busy reading that comes back FAST is not
  retried in a tight loop", 2.3 s under the full run's load). This branch does not touch that file (diff: two shell
  files and this plan). Run alone at 1a602f45ce three times: 55 pass, 0 fail each time. Read as contention, not this
  change; gate rerun. If it reds again in the gate, run it on origin/main under load before going further.

## Review round 33 (opus, blind, READ ONLY: the box was held by queued validations; HEAD 4aa78eb747)
- W FIXED: INT/TERM were ignored only AFTER `launchctl kill SIGTERM` returned, so a Ctrl-C during the kill call ran the
  exit-130 handler with the SIGTERM already sent: runner left down. ka-interrupt asserted exactly that. Now the ignore
  is set BEFORE the kill, and the INTERRUPTED handler is gone (before the SIGTERM nothing is stopped; the default ends
  the script). ka-interrupt now asserts the reload completes.
  CAUGHT IN THE FIX: the mutant that moves the ignore back after the kill SURVIVED. bash waiting on a child does not
  exit on SIGINT unless the child dies of it too, and the stub only signalled its parent. The stub now signals itself
  as well (a terminal Ctrl-C reaches the whole group; an ignored INT is inherited). Both mutants (after, none) red.
  Two `! has "INTERRUPTED"` negatives became vacuous with the handler gone; removed.
  ALSO MY ERROR: I edited the worktree while the 6j gate was queued on it. It had not started; stopped it (no leftover
  processes) and it reruns on the new HEAD.
- NIT2 FIXED: the dry-run note names all three loaded lines (semaphore, exit timeout, minimum runtime).
- DEFERRED: NIT1 (unreadable plist in a readable LaunchAgents: same as round 31 NIT4), NIT3 (a helper process set up a
  few cases before ka-outlives: works).
