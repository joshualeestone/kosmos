# redonce-5589: a repeating red state emails once a day, not every 15 minutes (kosmos#5589)

Follow-up to #5597 (sitedeploy-5589), found by the chaoskosmos-site workflow review, round 1.

GitHub emails the account that last edited a workflow's cron on EVERY failed scheduled run.
site-autodeploy.sh stayed red on every tick while a sha was parked, a retry alarm held, the lock was
wedged or origin could not be fetched (iterations 9 and 13 of #5597 made that deliberate, so a
finding is never hidden by later green runs). On the site workflow's 15-minute schedule that is up
to 96 emails a day to Josh's account, which buries the one that matters.

## Change

`red_once <cause> <message>`: the first tick of a repeating red state for a given sha and cause exits
1 and records `<sha> <cause>|<epoch>` in `$STATE/reported`. Later ticks of the same sha and cause
within a day print the message with "red already reported at ..." and exit 0. A new sha, a new cause,
or a day passing makes it red again. `park()` records itself as reported, so the tick after a park
does not send a second email. State changes (a first failure, the failure that parks, a checkout
fault, an emptied dist) stay red every time. A damaged report time counts as never reported.

## Weakest premise

Green ticks during a known failure: someone looking only at the latest run's colour sees green. The
run's own output says FAIL and "red already reported", and a red run exists for that sha and cause
within the day. That trade is the point: one email per problem per day instead of 96.
