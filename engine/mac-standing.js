'use strict';
/**
 * Federation Kosmos+ gate, W1 refresh: the board-side READ of the current account
 * standing from the coordinator's /v1/mac/standing route.
 *
 * 🛑 SIGNED THROUGH THE TUNNEL, NOT SENT FROM NODE (#3626). This module used to POST
 * the route itself over HTTPS, presenting the Mac's TLS client certificate and
 * believing that was the "mac signature". It was not. The coordinator's
 * verify_mac_request (kosmos-relay coordinator/src/auth.rs) reads only the
 * x-kosmos-mac-id / x-kosmos-ts / x-kosmos-sig headers and has no client-certificate
 * code at all, so every call answered 401 "missing signature headers". Measured
 * 2026-09-24T18:46:49Z against login.kosmosplus.com (kosmos#3626). The failure was
 * swallowed into null, so the refresh silently kept the enrolment-time value forever.
 *
 * The request now goes through remote.macRequest(), which runs the tunnel binary's
 * `mac-request` verb (kosmos-relay #103). The tunnel holds the Mac key and signs;
 * the board passes a route and a body and does no crypto ("NO CRYPTO HERE").
 *
 * This is the SOURCE that remote.js's refreshStandingIfStale() re-fetches on a TTL,
 * so an UPGRADE (paid after enrolment) takes effect within ~one TTL without a
 * re-sign-in; a LAPSE is caught within a TTL too, but the fed-route 403 stays the
 * HARD gate -- this only keeps the UI honest.
 *
 * Best-effort by contract: fetchStanding() resolves to the current standing STRING,
 * or null when it cannot be determined (not enrolled/switched-off, the tunnel
 * failed, the coordinator refused, or an unreadable answer). A null NEVER changes
 * the cache upstream (remote.js keeps the last-known value), so a transient failure
 * cannot flicker a member off. A failure is no longer silent: see logFailure().
 */

const ROUTE = '/v1/mac/standing';

/* Pull the standing string out of the coordinator's answer. ICK's confirmed
   StandingResp is { standing: 'good'|'off'|<other>, valid_until, grace_until,
   receipt } -- kosmos_plus is DERIVED (== standing=='good'), there is no bool field.
   Read `standing`. The `{ kosmos_plus:bool }` arm is kept only as a defensive
   fallback. Accepts the parsed object macRequest returns, or JSON text. */
function parseStanding(answer) {
  let j = answer;
  if (typeof answer === 'string') {
    try { j = JSON.parse(answer); } catch { return null; }
  }
  if (!j || typeof j !== 'object') return null;
  if (typeof j.standing === 'string') return j.standing;
  if (typeof j.kosmos_plus === 'boolean') return j.kosmos_plus ? 'good' : 'none';
  return null;
}

/* Log a failure ONCE, not on every TTL refresh. The first failure is written to
   stderr (the log launchd keeps for the board); the same reason again is not; a
   success clears the latch so the next failure is written again. Swallowing it
   entirely is how #3626 stayed invisible. */
let lastLogged = null;
function logFailure(because) {
  let reason = String(because || 'unknown failure');
  /* A board newer than its bundled tunnel (no `mac-request` verb yet) says this;
     name the cause, the way engine/phonenotify.js does for the same message. */
  if (/unrecognized subcommand/.test(reason)) reason += ' (the tunnel on this computer is too old to sign this; it arrives with the next Kosmos update)';
  if (reason === lastLogged) return;
  lastLogged = reason;
  try { process.stderr.write('kosmos#3626: ' + ROUTE + ' failed: ' + reason + '\n'); } catch { /* logging must not throw */ }
}
function clearFailure() { lastLogged = null; }

/* fetchStanding() -- best effort, never throws. Resolves to the standing string or null. */
async function fetchStanding() {
  /* 🛑 SUITE GUARD FIRST, before any require(). Under node's test runner NEVER run
     the real bundled tunnel: a test that enrols a sandbox Mac and lets this run would
     otherwise send a request to the PAID production coordinator (login.kosmosplus.com)
     signed with a sandbox key. Keyed on the tunnel-binary seam (the one remote.test.js
     uses): a test that supplies its own fake tunnel still runs the real path. */
  if (process.env.NODE_TEST_CONTEXT && !process.env.AGENT_WORKFORCE_TUNNEL_BIN) return null;
  let remote;
  try { remote = require('./remote'); } catch { return null; }
  try {
    // Gate on the switch AND enrolment: a PAID route must not be called when the
    // feature is off, and there is no Mac identity when not enrolled.
    if (!remote.read().on || !remote.enrolled()) return null;
    /* POST with an empty JSON object: the coordinator's route is POST, and the Mac is
       identified by the signature the tunnel adds, not by anything in the body. */
    const r = await remote.macRequest('POST', ROUTE, {});
    if (!r || !r.ok) { logFailure(r && r.because); return null; }
    const standing = parseStanding(r.data);
    if (standing === null) { logFailure('the answer carried no standing'); return null; }
    clearFailure();
    return standing;
  } catch (err) {
    logFailure(err && err.message);
    return null;
  }
}

module.exports = { ROUTE, fetchStanding, parseStanding };
