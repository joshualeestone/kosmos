# sitekick-6266: a reliable 15-minute trigger for the site deploy

Card: #6266 (filed by Angel from Splinter's report, 2026-10-15). Finished looks like: every merge to chaoskosmos-site
main goes live on installkosmos.com within about 15 minutes of the deploy job being free (or the job's own red says
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
- tools.site-deploy-kick-6266.test.js (now 11) with a fake gh that checks every call's exact arguments and applies the
  script's own --jq filter with jq, and a sandboxed state folder: one dispatch when behind;
  none when deployed, parked, paused or a run is active (quiet); a first run asks; every unreadable input exits 1
  with a line and dispatches nothing; the installer writes a valid plist (plutil on macOS), copies the script exactly,
  and --uninstall removes both. The test caught a redirect-order bug (a missing state file printed an error).
- Guards: all-node-tests-considered, windows-tests-1777, fixture-discipline, comment-deferral,
  web.machine-absence-claims, caches.fsync, shell-shard: pass.

## Weakest premise
Mortals' gh login keeps the workflow scope. If it is lost, every tick prints "could not dispatch" in the job's log,
which nobody reads; the GitHub schedule and push runs still work as before.

## Review 1 (opus), and what changed
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
