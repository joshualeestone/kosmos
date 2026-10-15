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
  job's own last-deployed. It does nothing when the job is paused, main is the parked sha, or a deploy run is already
  queued or running. Everything else (the cut check, the lock, retries, parking, reports) stays the job's, unchanged.
  It prints only when it dispatches or cannot read something.
- tools/install-site-deploy-kick.sh installs it the way the box's other ops jobs are installed: the script copied into
  ~/.local/libexec/kosmos-site-deploy-kick/, a LaunchAgent run with /bin/bash every 900 s. --uninstall removes both.
- Rejected: waiting inside the skipped job until the cut ends (it would hold the site repo's single runner, which PR
  CI shares, for the length of a cut). Rejected: having release.sh dispatch the deploy when a cut ends (covers only
  cuts, not the other "next tick" waits: a deploy still running, a retry). Rejected: a different cron minute (still
  GitHub's best effort).

## Not yet done (after merge, branches only until UNHOLD)
- Install on Mortals: `bash tools/install-site-deploy-kick.sh` from a checkout of main, as mortalkombat. Then check
  `launchctl print gui/$(id -u)/com.stonesyndicate.kosmos-site-deploy-kick` and the first log line.
- A one-line pointer in chaoskosmos-site's .github/workflows/site-deploy.yml header to this job.

## Evidence
- tools.site-deploy-kick-6266.test.js 4/4 with a fake gh and a sandboxed state folder: one dispatch when behind;
  none when deployed, parked, paused or a run is active (quiet); a first run asks; every unreadable input exits 1
  with a line and dispatches nothing; the installer writes a valid plist (plutil on macOS), copies the script exactly,
  and --uninstall removes both. The test caught a redirect-order bug (a missing state file printed an error).
- Guards: all-node-tests-considered, windows-tests-1777, fixture-discipline, comment-deferral,
  web.machine-absence-claims, caches.fsync, shell-shard: pass.

## Weakest premise
Mortals' gh login keeps the workflow scope. If it is lost, every tick prints "could not dispatch" in the job's log,
which nobody reads; the GitHub schedule and push runs still work as before.
