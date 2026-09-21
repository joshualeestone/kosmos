---
pre_challenge: true
method: challenge-loop
branch: fed-standing-refresh
diff_hash: 6797c7eadfa331829d7aac8a8b0faa0c5bbf9684e9a709bd72decd0a47d5b94e
validation: passed
subdir_audit: passed
timestamp: 2026-09-21T15:10:00Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (one independent blind adversarial review of the full diff by a fresh
reviewer, compared against the proven engine/updating.js precedent; no blockers, one
warning + two nits all fixed).
**Converged:** Yes.
**Net:** completes W1 (the pre-flip entitlement refresh for the merged federation Kosmos+
gate): a ~60s-TTL re-fetch of account standing from the mac-signed GET /v1/mac/standing, so
an UPGRADE (paid after enrolment) takes effect without re-sign-in. Fail-safe throughout; the
fed-route 403 stays the hard security gate.

#### Iteration 1 (independent blind review -- LAUNCH-CRITICAL, auth-adjacent)

The reviewer read the diff + both test files, ran the suite, confirmed the real CI path
(tools/run-tests.sh -> node --test, NODE_TEST_CONTEXT set), and traced the leak/lapse/
upgrade paths, the test-context guard, the non-blocking tick, and the mac-cert request
against updating.js. Result: **no blockers.**

- **[STRENGTH] No LEAK.** `parseStanding` never yields a UI-opening value for a non-good
  body (`{kosmos_plus:false}`->'none'; `{standing:'goodish'}`->'goodish' which fails
  `kosmosPlus()`'s exact `=== 'good'`; missing/non-bool/array->null). A null fetch never
  writes 'good' -- the failure branch writes only `standing_at`, and `write()` merges
  `...read()` so `standing` is preserved. Only a definite standing flips the UI.
- **[STRENGTH] No throw / no block on the 5s status tick.** fedKosmosPlusNow fires the
  refresh via an un-awaited `Promise.resolve(...).catch(()=>{})` inside its own try/catch;
  the request is bounded (socket timeout + destroy, MAX_BODY cap + destroy, agent:false,
  res 'error' handled); single-flight is race-free (no await between the flag check and set).
- **[STRENGTH] The suite guard genuinely prevents a real dial** to the paid production
  coordinator (login.kosmosplus.com) under test -- verified (the shipped-default test ran in
  ~1.5ms, no 4s dial), matching updating.js.
- **[WARNING -> fixed] the guard's own test was vacuous.** The "shipped default is a no-op"
  test asserted only that the cached value survived, which passes whether the guard fired OR
  a real dial failed the TLS handshake -- so a guard regression would not fail the suite.
  Added a NON-VACUOUS guard test in mac-standing.test.js that spies on the default transport
  (module.exports.dispatch) and asserts it is NEVER invoked; a regression calls the spy and
  fails. fetchStanding now uses module.exports.dispatch so it is spyable.
- **[NIT -> fixed] guard ordering.** Moved the NODE_TEST_CONTEXT guard BEFORE
  require('./remote'), aligning with updating.js's ahead-of-require discipline.
- **[NIT -> fixed] a hung request could pin single-flight.** A socket that stays active but
  never ends would leave the promise unresolved and pin standingRefreshInFlight=true,
  disabling future refreshes (non-fatal -- kosmosPlus keeps serving the cache). Added an
  overall unref'd backstop timeout so fetchStanding ALWAYS settles and the flag always clears.

### Validation
`engine/mac-standing.test.js` 9/9 (parse both shapes; not-enrolled/off no-request; 200 good
-> good + used the mac cert + the standing route; kosmos_plus bool maps; non-2xx/unparseable
-> null; error/timeout -> null never throws; the non-vacuous guard test); `engine/remote-
standing-refresh.test.js` 8/8 (upgrade/lapse/null-keeps/single-flight/no-throw/no-op-default);
the full node suite 7985 tests / 0 fail (engine + root). Diff is engine/server only (no web,
so the browser-check gates do not apply). One open, non-blocking: ICK's exact /v1/mac/standing
method/response-field confirmation (asked); the tolerant parse handles either `{standing}` or
`{kosmos_plus}`, and fail-safe holds regardless. The flip stays Splinter's (~Josh 3 PM).
