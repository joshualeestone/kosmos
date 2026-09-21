# W1: TTL entitlement-refresh (federation Kosmos+ gate, pre-flip)

## The task
Pre-flip follow-up to the merged #3353 (federation Kosmos+ gate). ICK's v1 ruling: an
enrolled board's `kosmos_plus` was FROZEN at enrolment-time standing, so a user who
UPGRADES to Kosmos+ after enrolling could not see the fed UI until re-sign-in. Fix:
re-fetch the account standing on a ~60s TTL so an upgrade lands within a minute (a lapse
too; the fed-route 403 stays the hard security gate — this only keeps the UI honest).
NOT flip-safety-blocking (the merged gate is fail-safe); gates the upgrade UX only.

## The source (ICK, corrected)
NOT a bearer `/v1/account/me` (the board holds no persistent bearer — the sign-in session
token is spent at register). IT IS the mac-signed **GET /v1/mac/standing**: the board
already makes mac-cert `/v1/mac/*` calls in node (`engine/updating.js` POSTs
`/v1/mac/updating` with `tls.crt/tls.key`). No binary verb, no Baron dependency.

## Design
- **`engine/mac-standing.js`** (new): `fetchStanding()` = mac-cert GET /v1/mac/standing,
  mirroring `updating.js`'s client (cert/key from the state dir, coordinator URL with path
  prefix, `agent:false`, no `ca`=system store, timeout+destroy, a `setRequestFactory` test
  seam, a `NODE_TEST_CONTEXT` suite guard). Reads + size-caps the response body and parses
  standing. Its own module so the https/cert stays OUT of `remote.js` ("NO CRYPTO HERE").
  - `parseStanding`: tolerant — `{standing:'good'}` string wins; else `{kosmos_plus:bool}`
    -> 'good'/'none'; else null. (kosmos_plus == standing=='good' is ICK's identity, so the
    mapping cannot disagree with the coordinator. Exact route shape confirmation asked of ICK.)
  - Best-effort: not-enrolled/off/non-2xx/unparseable/oversized/error/timeout all -> null.
- **`engine/remote.js`**: `read()` carries `standing_at` (ms of the last standing write);
  `fedSetStanding` stamps it. `refreshStandingIfStale()` = non-blocking, single-flighted,
  best-effort: when enrolled + the cache is older than STANDING_TTL_MS (~60s), it awaits an
  isolated `fetchStanding()` (delegates to mac-standing) and updates: a string sets+restamps;
  a null KEEPS the last-known value and backs the retry off to the next TTL (no flicker).
- **`server.js`**: `fedKosmosPlusNow()` SERVES the cached `kosmos_plus` immediately (never
  blocks the tick) and FIRES the refresh non-blocking (never awaited, never throws), so the
  next `/api/status` poll reflects an upgrade within ~one TTL.

## Fail-safe invariants (the leak must never happen)
- A fetch FAILURE (null) never writes 'good' — it keeps the last-known value.
- Only a DEFINITE non-good standing flips a member OFF; only a definite 'good' flips a
  non-member ON.
- The refresh never blocks or throws on the status tick; single-flight prevents stacked
  fetches; a hung request is bounded (timeout+destroy).
- Under `node --test` the shipped fetcher never dials the real coordinator (guard).

## Verification
- `engine/mac-standing.test.js` (8): parse both shapes; not-enrolled/off no-request; 200
  good -> good + used the mac cert + the standing route; kosmos_plus bool maps; non-2xx ->
  null; unparseable -> null; error/timeout -> null never throws.
- `engine/remote-standing-refresh.test.js` (8): upgrade / lapse / null-keeps-value /
  single-flight / no-throw / no-op-default (guarded).
- Full node suite 7984 tests / 0 fail (engine + root). Diff is engine/server only (no web,
  so the browser-check gates do not apply).

## Out of scope / open
- Exact `/v1/mac/standing` method + response field pending ICK's confirmation (asked); the
  tolerant parse handles either shape so this is not blocking. The flip is Splinter's,
  held for ~Josh's 3 PM return.
