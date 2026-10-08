# redonce-5589: a repeating red state emails once a day, not every 15 minutes (kosmos#5589)

Follow-up to #5597 (sitedeploy-5589), found by the chaoskosmos-site workflow review, round 1.

GitHub emails the account that last edited a workflow's cron on EVERY failed scheduled run.
site-autodeploy.sh stayed red on every tick while a sha was parked, a retry alarm held, the lock was
wedged or origin could not be fetched (iterations 9 and 13 of #5597 made that deliberate, so a
finding is never hidden by later green runs). On the site workflow's 15-minute schedule that is up
to 96 emails a day to Josh's account, which buries the one that matters.

## Change

`red_once <cause> <message>`: the first tick of a repeating red state for a given sha and cause exits 1
and records the time in `$STATE/reported.d/<sha>-<cause>` (one file per sha and cause). Later ticks of
the same sha and cause within a rolling 24 hours print "STILL FAILING (reported): ..." and exit 0. A new
sha, a new cause, a successful deploy (all records removed), or 24 hours passing makes it red again. The
states with a clean recovery moment (wedged lock, fetch, origin/main) also clear the moment they
recover. The retry-type causes (pointer, unread, mirror, checksum, moving) clear only on a
successful deploy: until then that sha has not shipped, so a second incident of the same cause on it
within the day is the same open problem, reported green; clearing on any passing check would let two
alternating causes re-arm each other every tick (review round 4 considered both; this is the choice).
`park()` records itself, so the tick after a park does not send a second email. State changes (a first
failure, the failure that parks, a checkout fault, an emptied dist) stay red every time. A damaged or
future-dated record counts as never reported.

## Weakest premise

Green ticks during a known failure: someone looking only at the latest run's colour sees green. The
run's own output says FAIL and "red already reported", and a red run exists for that sha and cause
within the day. That trade is the point: one email per problem per day instead of 96.

## Also on this branch (from the site workflow's review round 3)

**The deploy has its own wall-clock limit** (KOSMOS_AUTODEPLOY_DEPLOY_MAX_S, default 900 s), well inside
the workflow's 30-minute job timeout, so a hang is counted here (a FAILURE, exit 124: retried once, then
parked; not a retry, because it may have published before hanging) instead of the runner killing the job
with nothing recorded. Measured 2026-10-08: the 0.7.28 prod promote's deploy-site.sh --promote took 2
min 18 s on Mortals. The deploy runs in its own process group with stdin from /dev/null; at the limit,
or if the tick itself is killed (the runner cancelling the job), the whole group is stopped, vercel
included.

A tick killed mid-deploy also records a failure (rc 143), since the deploy may have published. The deploy
limit is measured on the clock and capped at 20 minutes; it bounds the deploy phase only.

## Records and recovery (review rounds 1 and 2)

One record per sha and cause (`reported.d/<sha>-<cause>`), removed when its cause is seen to recover
(fetch works, lock taken, origin/main found) and all removed on a successful deploy or main found live.
A future-dated record counts as never reported.

## Orphans, signals and limits (review rounds 11 and 12)

- **A tick killed outright** (SIGKILL; no EXIT trap) leaves its deploy running in its own group. The
  launch writes `deploy.pid` ("<pgid> <sha> <leader start time>"); the next tick that finds it waits while
  it is under 1200 s, then stops it, and counts it a failure either way (rc 137), so the "already live"
  shortcut never blesses its sha. Identity: while the leader lives only the same start time (read with
  LC_ALL=C TZ=UTC) is ours; once the leader is gone, a group that still has members is ours, since a pid
  is not reused while its process group exists. A deploy.pid with no start time never signals a live leader.
- **The launch cannot be cut**: from just before the fork until deploy.pid is written a signal is only
  noted (trapped, not ignored, so the deploy itself stays signalable), then acted on.
- **killed_tick** ignores further signals and records the failure before the slow stop, so a runner's
  escalating cancel cannot cut out the record. Group liveness (kill -0 -pgid) throughout; a child the
  deploy leaves running after it exits is stopped.
- **The fetch** has a seam (KOSMOS_AUTODEPLOY_FETCH_MAX_S, default 120, at most 600) and perl stops its
  group TERM then KILL on the alarm AND on a signal. Not changed: a TERM to the tick's pid alone waits for
  the fetch (bash runs a trap after the foreground command), at most the limit; the runner's cancel
  signals the whole tree.
- **Every new test was red-checked** against a copy with its fix removed.
- Not tested: the launch window itself (microseconds wide; not reproducible on demand), and a mirror
  arm under root (the runner is not root).
- **The deploy's result is never lost to a kill** (round 13): killed_tick stays the EXIT trap from the
  launch until the result is written (an `accounted` flag set in each branch), and records rc 143 for
  anything not yet accounted, whether the deploy still runs or has just ended. The output is printed once.
- **The leaderless-group check reads the whole pgid list, then matches** (no `| grep -q` at the end of a
  pipeline, which under pipefail reads 141 as a miss once ps prints past a pipe buffer; measured by the
  reviewer: 20 of 20). Not tested: neither the pipe-buffer size nor the kill-between-end-and-record
  window can be produced on demand without a seam in production code; both fixes are by construction.
- **The ceiling is never silently off, and never leaky** (round 14): a release pointer on main that yields
  no readable version parks (no ceiling would mirror unreleased builds); a build above the ceiling that is
  already in this dist/ AND still in the source is removed before the deploy (the rsync exclude that keeps
  it from being copied also protects it from --delete). Test 33 first planted a version absent from the
  source, which rsync deletes anyway, so it passed with the fix removed; it now plants one the source
  still holds, and is red without the fix.
- Test 26's leftover count matched `^sleep N$`, but ps names the helper `/bin/sleep N`, so it could never
  see one; now `(^|/)sleep N$`, with a control that starts one and counts it.
- **A damaged number never aborts a tick** (round 15): a report time, a count or the mirror count with a
  leading zero (089 is invalid octal to bash) reads as 0, like any other damaged value; tested with
  0899999999 (red without the fix). The fetch cap is 300 s so the fetch and deploy caps together leave 5
  of the job's 30 minutes. perl installs its signal handlers before the fork and both sides set the
  child's group, closing two microsecond-wide races.
