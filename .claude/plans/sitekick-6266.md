# sitekick-6266: a reliable 15-minute trigger for the site deploy

Card: #6266 (filed by Angel from Splinter's report, 2026-10-15). Finished looks like: every merge to chaoskosmos-site
main goes live on installkosmos.com within about 15 to 30 minutes of the deploy job being free (the merge's own push
run usually sooner) (or the job's own red says
why), without a person dispatching it.

## Cause (measured from the run list and logs, 2026-10-15)
- The push run at 21:20Z (16:20 CDT) for site main 78c60ce2f logged "skip: a release cut, deploy or promote is
  running; main 78c60ce2f waits for the next tick". The 0.7.51 cut then failed on a test gate and published nothing.
- GitHub fired the */15 schedule six times that day: 00:32, 05:15, 10:12, 15:05, 19:08 and 22:19 UTC. So "the next
  tick" did not come until Mona's manual dispatch at 22:19Z (17:19 CDT), which deployed 78c60ce2f.
- GitHub documents scheduled workflows as best effort, delayed or dropped under load: the backstop cannot rest on it.

## Call
- tools/site-deploy-kick.sh, run every 15 minutes by launchd on Mortals (the runner box, whose gh login has the
  workflow scope, checked read-only), dispatches the site deploy workflow on main only when site main differs from the
  job's own last-deployed. It does nothing when the job is paused, main is the parked sha, a deploy run is queued or
  running, or a deploy run was created, or (one that failed) ended, under 14 minutes ago (a
  backstop, never an extra tick: the job's one retry and its parking keep their 15-minute pace). A STUCK run (not
  finished 3 hours after creation: GitHub stamps startedAt at creation, so queue and running time cannot be told
  apart) is said, is not waited on and does not hold the gap, and the tick exits 1 so launchctl's
  last exit code shows it; each tick writes a heartbeat;
  --check says what a tick would decide without dispatching. Everything else (the cut check, the lock, retries, parking, reports) stays the job's, unchanged.
  It prints only when it dispatches, cannot read something, or sees a stuck run.
- tools/install-site-deploy-kick.sh installs it the way the box's other ops jobs are installed: the script copied into
  ~/.local/libexec/kosmos-site-deploy-kick/, a LaunchAgent run with /bin/bash every 900 s. --uninstall removes both.
- Rejected: waiting inside the skipped job until the cut ends (it would hold the site repo's single runner, which PR
  CI shares, for the length of a cut). Rejected: having release.sh dispatch the deploy when a cut ends (covers only
  cuts, not the other "next tick" waits: a deploy still running, a retry). Rejected: a different cron minute (still
  GitHub's best effort).

## Not yet done (after merge, branches only until UNHOLD)
- Install on Mortals: `bash tools/install-site-deploy-kick.sh` from a checkout of main, as mortalkombat. Then: kick.sh
  --check (what it would decide, and the commit it was installed from), `launchctl print ... | grep -E 'state|last
  exit code'`, last-tick advancing (launchd starts it), and kick.log: an "asked" line, or no "could not read" line
  after a tick with main ahead, is what proves gh works under launchd.
- A one-line pointer in chaoskosmos-site's .github/workflows/site-deploy.yml header to this job.

## Evidence
- tools.site-deploy-kick-6266.test.js (now 17) with a fake gh that checks every call's exact arguments and applies the
  script's own --jq filter with jq, and a sandboxed state folder: one dispatch when behind;
  none when deployed, parked, paused or a run is active (quiet); a first run asks; every unreadable input exits 1
  with a line and dispatches nothing; the installer writes a valid plist (plutil on macOS), copies the script exactly,
  and --uninstall removes both. The test caught a redirect-order bug (a missing state file printed an error).
- Guards: all-node-tests-considered, windows-tests-1777, fixture-discipline, comment-deferral,
  web.machine-absence-claims, caches.fsync, shell-shard: pass.

## Weakest premise
Mortals' gh login keeps the workflow scope. If it is lost, every tick prints "could not read site main" (or, with only the
workflow scope lost, "could not dispatch") in kick.log, last-result and launchctl's last exit code; the GitHub schedule and push runs still work as before.

## Review 1 (opus), and what changed
- (Superseded by reviews 3 and 4: the 45-minute stuck rule below became 3 hours from creation.)
- WARNING: it could dispatch minutes after a failed run, spending the job's one retry early: now it waits until no run
  started in the last 14 minutes (test; mutant red). WARNING: the fake gh ignored --jq: it now checks exact argv and
  runs the filter with jq (it caught an argument count I had wrong in the fake). WARNING: a stuck queued run silenced
  it: a run active over 45 minutes is said each tick (test; mutant red). WARNING: nothing proved it runs under
  launchd: heartbeat file, --check, and post-install checks in the installer header. NITs taken: an in-progress run's
  comment; the installer retries a failed bootstrap once and says what to run; uninstall removes leftover .new files
  and the heartbeat; the libexec pattern names the job it copies; the test checks RunAtLoad, HOME, PATH and a second
  install; the log's growth is stated.

## Review 2 (sonnet), and what changed
- WARNING: gh's own error was thrown away: its first line now goes into the log line (a lost login reads as one;
  test). WARNING: a zombie run silenced the backstop for good: a run active over 45 minutes is no longer waited on,
  is said, and the tick exits 1 (test; mutant red). WARNING: the gap trusted gh's order: it uses the newest by time
  (test oldest-first; mutant red). WARNING: the installer header now says the user needs a desktop session (gui/<uid>).
  NITs taken: the gap is pinned at 830 vs 850 s (mutant at 800 red); mixed runs tested; jq absence skips only off
  macOS; the date fallback is commented. Noted: the heartbeat proves launchd starts it, the log proves what it did.

## Review 3 (opus), and what changed
- (Superseded by reviews 4 and 6: stuck is now 3 hours from creation; only a FAILED run's end holds the gap.)
- WARNING: the gap counted from a run's creation, so a run that queued long and failed just now was retried at once:
  it now counts from the later of created and updated (test: created 1000 s, updated 60 s ago; mutant red).
  WARNING: "stuck" counted queue time against the 45-minute job timeout: a running run counts from its start, a waiting
  one gets 3 hours (tests both ways; mutants red); a stuck run no longer holds the gap; the comment no longer claims a
  new dispatch replaces a queued run. WARNING: the garbled-time case parsed on GNU date: an impossible date now.
  WARNING: the installer's cp && chmod && mv could fail silently under set -e: one step per line. NITs taken: a parse
  error's line goes to stderr (it was being captured as the value, found while fixing); mktemp failure stops the tick;
  the log's growth stated truly; --uninstall keeps kick.log and says where. Left: plist values are not XML-escaped
  (the paths are fixed and plain on Mortals).

## Review 4 (sonnet), and what changed
- WARNING: startedAt might be stamped at creation. MEASURED on chaoskosmos-site (8 site-deploy and 8 test runs,
  2026-10-15): startedAt equals createdAt on every run. So "running 45 minutes from its start" could not be measured:
  one limit, 3 hours from creation, for any unfinished run (tests both ways); the fixture no longer invents a startedAt.
  WARNING: "never an extra tick" was more than the code can promise (GitHub's schedule and push still fire on their
  own): reworded. WARNING, accepted and stated: during a long cut each tick's run is skipped by the job in seconds, one
  per 15 minutes on the shared runner, which is the pace the schedule was meant to have. NITs taken: a parked sha
  other than main still dispatches (test); a paused tick writes its heartbeat (test); the installer names launchctl
  enable; the header says heartbeat = started, log = what it did.

## Review 5 (opus), and what changed
- WARNING: the plan said an advancing heartbeat proves gh works under launchd: it proves launchd started the tick;
  the post-install step now names kick.log as the proof. WARNING: with no state folder (or the wrong one) it read
  nothing as paused/parked/deployed and would ask every tick: it now refuses with a line and exits 1 (test). NITs
  taken: the plan's print list includes the stuck line; a long comment rewrapped; the stuck comment states the
  near-3-hour false positive; the installer records the source commit and --check prints it; the installer's retry
  and failure message are tested.

## Review 6 (sonnet), and what changed
- WARNING: counting every run's last update left a minute of slack against the 15-minute tick, so a slow green run
  (or a skip behind CI) pushed the next ask to 30 minutes: only a FAILED run's end counts now (failure, timed_out,
  startup_failure), others count from creation (tests both ways; mutants red). WARNING: no visible failure signal:
  each tick leaves last-result (exit code and last line) and --check shows it (test). NITs taken: the source commit
  is marked -dirty when the installed script differs from it; this plan's test count; the log's size (about 10 KB a
  day at worst).

## Review 7 (opus), and what changed
- BLOCKER (measured): gh gives an unfinished run's conclusion as "" (not null), so "// "-"" never fired and the
  space-separated line shifted every field: any tick seeing a queued or running run failed to read it, and the stuck
  escape could never fire. Now the line is TAB-separated (@tsv, IFS=tab) and "" maps to "-". BLOCKER: the test data
  gave unfinished runs a null conclusion, which hid it; it now gives "" as gh does, and the old parse turns 3 tests
  red. WARNING: a garbled time's reason was said in a subshell and lost from last-result: the parent sets it. WARNING:
  a stuck tick that then asked recorded only "asked": last-result keeps the stuck reason. WARNING: the 20-run window:
  commented (one run at a time, superseded pending runs cancelled). NITs taken: "differs from", a gh fallback through
  PATH, tests for timed_out, startup_failure and cancelled, both scripts in test:shell's bash -n list, the RunAtLoad
  note.

## Review 8 (sonnet), and what changed
- No BLOCKER; it checked the test data against real gh output (unfinished conclusion "", startedAt equal to
  createdAt) and found it matches. WARNINGs stated, not fixed, now in the script header: GitHub's own schedule can
  land just after an ask (two runs minutes apart, the job's retry alarm sooner; rare, as the schedule is); a lost gh
  login fails every tick and is seen only in kick.log, last-result and launchctl (accepted, the weakest premise);
  live gone back to an older commit while main is unchanged is left to the job's schedule. NITs taken: a test label
  that said "failed" for a green run; the log-size figure.

## Review 9 (opus), and what changed
- No BLOCKER. WARNING: the header promised it never asks beside a recent run; only a recent creation or failure holds
  it, so a green "try again later" exit from a run over 13 minutes can be followed by an ask within minutes: the
  sentence is narrowed and that case stated (rare). NITs taken: heartbeat and trap set before mktemp; the redundant
  stuck guard on the gap commented as clarity only; --check wording; --uninstall refuses extra arguments; a long
  comment line rewrapped.

## Review 10 (sonnet), and what changed
- No BLOCKER. WARNING: the GNU date -d fallback was also tried on macOS, where -d means something else: the form is
  chosen by uname. WARNING: a merge can wait 15 to 30 minutes, not about 15: the finished criterion says so (the
  merge's own push run is usually sooner). WARNING: the stuck line now gives its age in minutes. NIT taken: the plan's
  45-minute rule marked superseded.

## Review 11 (opus), and what changed
- No BLOCKER. WARNING: no gh call had a time limit, and launchd never starts a second copy while one runs, so one
  hung call (a stalled connection) could hold the backstop for ever with nothing logged: each call now has a perl
  alarm wall clock (90 s, as the deploy job's own network calls), a timeout fails like any other read with "timed out
  after N s" (test with a fake gh that sleeps). NITs taken: an unknown argument exits 2 instead of running a real
  tick (test); mktemp uses a full template; a garbled updatedAt on a failed run is tested; "the newest 20 runs" wording;
  review 3 marked superseded; the libexec pattern says it was seen on Mortals.

## Review 12 (sonnet), and what changed
- (Superseded by review 15: gh now stays in the tick's process group; perl kills gh's pid, not a group.)
- BLOCKER (the reviewer measured it): gh is a Go program and Go ignores SIGALRM, so `perl -e 'alarm; exec gh'` never
  stopped a hung gh (it ran its own 30 s dial timeout past a 3 s alarm), and the test passed only because its fake gh
  was bash. Now perl forks gh into its own process group, waits, and at the deadline sends the group TERM then KILL and
  exits 142. MEASURED against the real gh on Agent1s (GH_HOST=10.255.255.1, limit 3 s): cut off in 5 s (3 s plus the
  2 s grace before KILL), "timed out after 3 s" in the line, no gh left running. The fake gh now ignores SIGALRM as Go
  does, and the test asserts the call returns in under 10 s while the fake sleeps 20. NIT taken: a gh that is not
  there says "no gh found". Left: the -dirty mark covers the script itself, not the installer or a stale checkout.

## Review 13 (opus), and what changed
- (Superseded by review 15: gh stays in the tick's group; the signal hand-off remains, to gh's pid.)
- No BLOCKER. WARNING: the wrapper copied only half of the deploy job's grouped_timeout: gh in its own group was out
  of reach of launchd's bootout and of a Ctrl-C, so an uninstall or reinstall mid-call could leave a gh workflow run
  dispatching afterwards. Now the full shape: TERM/INT/HUP handlers before the fork pass the signal to the gh group,
  the group is set from both sides (test: TERM the tick's group, the fake gh's group is gone; mutant without the
  handler red). NITs taken: the alarm is cancelled once gh is reaped; KOSMOS_KICK_GH_TIMEOUT is validated (never 0)
  and listed in the header; why() names 125, 126 and 127 honestly; the no-gh case is its own test; this plan's test
  count (15); a long header line rewrapped.

## Review 14 (sonnet), and what changed
- No BLOCKER. WARNING: the no-gh test passed only because PATH held no gh; it now skips, saying why, where /usr/bin or
  /bin has one. CONVENTION: the comments' "review N" tags (history a reader cannot see) are replaced by their reasons;
  the history stays here. NITs taken: the 3-hour limit pinned at 10700 vs 10900 s; the TERM test always cleans up its
  fake; --uninstall says "nothing to remove" when nothing was installed. Left (stated): -dirty covers only the script.

## Review 15 (opus), and what changed
- No BLOCKER. WARNING (unmeasured but well-founded): launchd stops a job by TERM to its main process and then cleans up
  the job's process group, by force; a forced kill runs no handler, so gh in its OWN group would be orphaned and could
  still dispatch after an uninstall. gh now stays in the tick's process group; perl kills gh's pid at the deadline
  (gh has no helpers to take down) and passes TERM/INT/HUP on. Test: SIGKILL the tick's group, gh is gone (the
  own-group design fails it). WARNING: the source-commit test accepted "unknown": it now requires this checkout's sha
  (with an optional -dirty). NITs taken: --check prints the gh limit and a 0 limit is shown refused (test); the log's
  worst case (about 40 KB a day); the fake gh's pid read is inside the test's try, with cleanup; the weakest premise's
  wording. Left: cut -c1-160 counts bytes (can split a character in gh's error; cosmetic).
- Re-measured against the real gh (GH_HOST=10.255.255.1, limit 3 s): cut off in 5 s, "timed out after 3 s", no
  gh process left.

## Review 16 (sonnet), and what changed
- No BLOCKER. WARNING: the TERM/INT/HUP hand-off was claimed but untested (the SIGKILL test passes without it): a
  test now sends TERM to the perl wrapper alone and asserts gh is gone (mutant without the handler red). NIT taken:
  reviews 12 and 13 marked superseded. Left (stated): cut counts bytes; plist values unescaped; a future-dated run
  holds the tick back until clocks agree (fails safe).
