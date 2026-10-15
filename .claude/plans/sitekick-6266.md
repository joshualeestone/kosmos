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
  workflow scope, checked read-only), dispatches the site deploy workflow on main only when site main is ahead of the
  job's own last-deployed. It does nothing when the job is paused, main is the parked sha, a deploy run is queued or
  running, or a deploy run was created or last updated (a finished run: when it ended) under 14 minutes ago (a
  backstop, never an extra tick: the job's one retry and its parking keep their 15-minute pace). A STUCK run (running
  45 minutes from its start, the job's timeout; or waiting to start 3 hours, since the shared runner's CI queue can
  hold a real run a while) is said, is not waited on and does not hold the gap, and the tick exits 1 so launchctl's
  last exit code shows it; each tick writes a heartbeat;
  --check says what a tick would decide without dispatching. Everything else (the cut check, the lock, retries, parking, reports) stays the job's, unchanged.
  It prints only when it dispatches or cannot read something.
- tools/install-site-deploy-kick.sh installs it the way the box's other ops jobs are installed: the script copied into
  ~/.local/libexec/kosmos-site-deploy-kick/, a LaunchAgent run with /bin/bash every 900 s. --uninstall removes both.
- Rejected: waiting inside the skipped job until the cut ends (it would hold the site repo's single runner, which PR
  CI shares, for the length of a cut). Rejected: having release.sh dispatch the deploy when a cut ends (covers only
  cuts, not the other "next tick" waits: a deploy still running, a retry). Rejected: a different cron minute (still
  GitHub's best effort).

## Not yet done (after merge, branches only until UNHOLD)
- Install on Mortals: `bash tools/install-site-deploy-kick.sh` from a checkout of main, as mortalkombat. Then: kick.sh
  --check (what it would decide), `launchctl print ... | grep -E 'state|last exit code'`, and last-tick advancing
  after 15 minutes (proves launchd runs it with a working gh, not only this shell).
- A one-line pointer in chaoskosmos-site's .github/workflows/site-deploy.yml header to this job.

## Evidence
- tools.site-deploy-kick-6266.test.js (now 8) with a fake gh that checks every call's exact arguments and applies the
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
