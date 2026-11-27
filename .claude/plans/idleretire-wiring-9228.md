# kosmos#9228: test the idle-retire sweep's wiring and its operator brake (follow-up to #8720)

## Done
1. The sweep's wiring is one function, idleRetireSweepDeps(), that start() hands makeTick. A test drives it through the
   real roster and the real engine/remove.js under AGENT_WORKFORCE_DRY_RUN=1 (a dry-run REMOVED is recorded as refused,
   with remove.js's own "Nothing actually happened" sentence, so a stub cannot pass). A source check pins that start()
   uses it. Red with remove stubbed.
2. The brake: idleRetireActive(allowed, env) and idleRetireSweepDeps({ liveAllowed, env }) take their inputs, so the
   test checks the sweep's own allowed with live execution read as on (acts) and with the brake set (stops), without
   turning live execution on in a test process. Red with the brake dropped from the sweep.
3. The Settings hint says any state but idle or stopped is kept, with examples.
4. Known limit (a running day is a day the board ticked once), left as written on the card.

## Rejected
Turning live execution on inside the test: it would let real removal commands run on the machine running the suite.

## Weakest premise
That removal.remove under AGENT_WORKFORCE_DRY_RUN=1 with sandboxed roots touches nothing real. Checked from
engine/remove.js by both reviewers (run() and runAsync return before any exec; recordRemoval returns at once).
