# Plan: #1585 cover the #1560 guard at the /api/connect/start route

## Problem

A green server-route suite implied coverage it did not have. Disabling the
#1560 guard in engine/connect.js (the `live.state === NONE` branch changed to
`if (false)`) reds engine/connect.test.js but left every test in
server.connect.test.js green. So the route layer certified coverage of the
guard that it never actually exercised: a paid-plan config file plus a
signed-out live check was never driven through /api/connect/start.

## Fix

Add the route-layer mirror of the engine's #1560 pair, using the
`subscription.setRunner` seam server.connect.test.js already uses:

1. A connected-looking config file plus a live check that says signed out
   (`loggedIn: false`) must not answer connected through /api/connect/start.
2. CONTROL: when the live check agrees the file (`loggedIn: true`), the route
   still answers connected, plan intact. Without this arm the first test is
   satisfied by a change that simply never reports connected.
3. CONTROL: an UNVERIFIABLE live check (the probe throws, so checkLive answers
   UNKNOWN) must still answer connected, not force a signed-in customer into
   sign-in. This completes the route mirror of the engine's #1560 trio
   (NONE / CONNECTED-agree / UNKNOWN) and pins the load-bearing distinction
   that the guard reads `=== NONE`, not `!== CONNECTED`.

Test-only change. No production code touched.

## Verification

Arm by arm, each test reds only under its own meaningful mutation:
- Unmodified guard: all three tests pass, full server.connect.test.js 38/38.
- Guard set to `if (false)`: the guard test reds; both controls stay green.
- Guard set to `!== CONNECTED` (the wrong form): only the UNKNOWN control reds.
- Restored: engine/connect.js diff empty.
