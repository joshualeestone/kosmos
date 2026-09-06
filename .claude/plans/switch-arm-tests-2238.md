# Plan: route-level coverage for the #2238 world-switch restart arms

## Why
The #2238 board-restart-on-switch primitive (merged, #2346) has good unit coverage of
canSelfRestart's fail-safe branches (boardrestart-2238.test.js) and the booted-world capture
(worldenv.booted-2238.test.js). But the ROUTE-level restart arms of POST /api/worlds/active ride
Josh's fresh-install re-test BLIND: on the shared/from-source box canSelfRestart is always false, so
the restarting:true FIRED-restart arm can never be exercised there (an iteration-2 review of the
original PR flagged it untested), and the no-op / manual-banner arms only ever take one branch.
Splinter routed this as insurance for exactly the arms no e2e on this box can cover.

## What
One new test file, server.switch-arms-2238.test.js. It boots the server (full sandbox) and mocks
boardrestart.canSelfRestart + selfRestart (the route calls them via require, so the patch takes;
selfRestart is a spy that never issues a real launchctl stop) to drive all three arms:
1. canSelfRestart true + a real switch -> restarting:true, restartRequired:true, selfRestart fires
   AFTER the response (never before it flushes), exactly once (polled via waitUntil).
2. canSelfRestart false + a real switch -> restarting:false, restartRequired:true, no fire (the
   manual-banner arm a from-source board takes; un-brickable).
3. A no-op switch to the already-booted world -> restartRequired:false, restarting:false, no fire,
   even with canSelfRestart true (proves isNoop short-circuits).
Originals restored in test.after; per-root temp dirs cleaned up.

## Scope / risk
Test-only. No product code changes. Non-colliding (Angel's #2348 is web). The fail-safe branches of
canSelfRestart itself and the booted-world capture are covered by their own files; this covers the
route glue that binds them, which was previously only 1 assertion (restarting:false for a non-board
process).
