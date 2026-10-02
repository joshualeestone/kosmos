# checkquiet-4253: a check run on its own never phones home

Card: joshualeestone/kosmos#4253 (install telemetry flooded by fresh-id pings).

## Measured first (10-02 15:40 CDT, live /api/admin-telemetry, admin token)
New install ids per day: 09-25 7,100 / 09-26 8,553 / 09-27 7,552, then after #4276 (4c29aa0ef, merged 09-27 21:25
CDT, the runners sealed) 09-28 479 / 09-29 916 / 09-30 516 / 10-01 158 / 10-02 279 so far. So the runner fix took out
about 95%. The residual: today's 279 are 253 mac, 0 agents, 0 reports, one record, all US, in bursts by the hour
(41 in the 16:00 UTC hour). That is the fleet's shape, not a person's.

## Where the residual comes from (read, not measured per source)
Every launcher of server.js outside the runners, on origin/main, that names neither the sink nor lib-sandbox-home:
- 109 browser checks that name server.js also require docs/browser-checks/lib-sandbox-home.js (counted 10-02 on
  origin/main; more files mention the lib). Run through tools/browser-checks.sh they inherit
  its exports; run on their own (`node docs/browser-checks/x.js`, the usual way to try one check, and /design-shots'
  mobile-shots.js) they phone home.
- tools/fed-own-e2e.js builds each board's env from nothing (PATH, LANG, ...), so its three boards are unsealed.
- NOT covered: 27 checks that do not require the lib and whose headers tell the reader to start the board by hand
  (`AGENT_WORKFORCE_DATA=/tmp/x PORT=... node server.js &`). A board started that way is a plain server.js, which
  is the product, so it still phones home. browser-checks.sh boots those with its exports; only the hand recipe leaks.
- engine/, install/, deploy/ name server.js but are the product: the real install ping stays (Josh 09-14, #3038).

## Change
- lib-sandbox-home.js: AGENT_WORKFORCE_CREATED_URL, _FEEDBACK_URL and _COMMUNITY_URL default to the same dead port
  the runners use, only when unset (a caller's own sink wins).
- fed-own-e2e.js boardEnv: the same three.
- tools.browser-checks-quiet-4253.test.js: control (no lib: the beacon's own send goes to installkosmos.com), lib
  (dead port for all three), a caller's address kept, and the federation boards named. Mutations: dropping the lib's
  loop reds two arms; dropping one fed key reds the fed arm.

## Decided, not missed
- Not done: standalone runs of tools/test-*.sh. Most run under run-tests.sh (which exports the sink); a shell
  harness has no shared require point, so each would need its own line. Left for a measurement that shows them.
- Not done: discounting the ids already stored. A public-number decision, held (Splinter's hold, rule C).
- The community URL is sealed too: a fixture board with agents could otherwise post to the real community.

## Weakest premise
That standalone checks and the fed proof are most of the ~250 a day. Not measured per source; the telemetry carries
no source. Measure again two days after this merges: if the silent count does not fall, the rest is elsewhere
(walk harnesses installing the real app, which are real installs by design, are the next suspect).
