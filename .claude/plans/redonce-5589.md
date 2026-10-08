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

A deploy that hangs is stopped at its 15-minute limit (by the clock, capped at 25 minutes so it stays
inside the job timeout) and counted as a FAILURE: red, retried once, then parked. A tick killed mid-deploy
also records a failure (rc 143), since the deploy may have published. A hang is a fault to fix.

## Records and recovery (review rounds 1 and 2)

One record per sha and cause (`reported.d/<sha>-<cause>`), removed when its cause is seen to recover
(fetch works, lock taken, origin/main found) and all removed on a successful deploy or main found live.
A future-dated record counts as never reported.
