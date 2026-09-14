'use strict';

/**
 * Telling installkosmos.com that an install exists and how many agents it has,
 * so the homepage install + agent counts move (#3038 / #238).
 *
 * 🛑 JOSH RULED THIS BACK IN (#3038, 2026-09-14). The create-agent beacon and its
 * toggles were removed by an AGENT in #2623; Josh confirmed that removal was NOT
 * his and that he has "always wanted" the beacon (Splinter relayed the ruling
 * verbatim-grounded on #3038). So this RESTORES what he asked for. It is the
 * TRANSMIT layer only; the server (chaoskosmos-site/api/created.js) records it.
 *
 * TWO signals leave the machine here, both fire-and-forget:
 *   - install ping   UNCONDITIONAL, on board start. Registers the install with
 *                    count 0, so the homepage INSTALL count moves. It carries NO
 *                    agent information -- an install shares only "an install
 *                    exists", never how many agents it runs.
 *   - created ping   on agent create, GATED on the create-agent checkbox
 *                    (default CHECKED, hardcoded on the form, #238). Carries the
 *                    install's TOTAL-EVER-CREATED count (create.createdCount,
 *                    from the birth log; #3038 -- NOT the live running roster,
 *                    which froze at peak-running under Math.max), so the homepage
 *                    AGENT count moves to the true number (not +1 -- see below).
 *
 * The split is deliberate: the install ping cannot be opted out (it is just a
 * headcount of installs and reveals nothing about agents), and the agent count
 * -- the one thing the checkbox governs -- only leaves when the checkbox is on.
 *
 * 🔑 THE SERVER IS IDEMPOTENT ON `count` (Math.max), NOT an incrementer. Both
 * pings send `count`, and created.js keeps ONE blob per install whose count is
 * Math.max(existing, count). So:
 *   - an install can ping any number of times (every board start) without ever
 *     inflating a number -- the install ping's count 0 never lowers a real one;
 *   - ONE created ping after an upgrade carries the TOTAL-EVER-CREATED count
 *     (read from the full birth log), so an install that already had N agents
 *     before this beacon shipped is counted in full the first time it creates one
 *     more, rather than climbing +1 forever.
 * The contract with the collector is exactly:
 *   POST <endpoint>  application/json
 *   { installId, count, version, os }
 *   200 { ok: true }
 * payload() below is the single source of that shape; a test pins the keys so
 * the two sides cannot drift.
 *
 * 🛑 A SEND CAN NEVER BLOCK, SLOW, OR THROW INTO A CALLER. Every path is
 * fire-and-forget with a short timeout and every error is swallowed -- the
 * ping.js / feedbacksend.js discipline, for the same reason: the person asked to
 * create an agent (or just launched the board), not for a network round-trip.
 * 🛑 installId is RANDOM and per-install (engine/ping.js): it identifies an
 * install, never a machine or a person. Nothing agent-identifying (names,
 * instructions, conversations, files) is in this payload -- only a count.
 */

const os = require('node:os');
const ping = require('./ping');       // installId + the under-test guard

const DEFAULT_ENDPOINT = 'https://installkosmos.com/api/created';

let sender = null;   // tests inject; production uses global fetch
const endpoint = () => process.env.AGENT_WORKFORCE_CREATED_URL || DEFAULT_ENDPOINT;

/**
 * This install's Kosmos version, best-effort. Stored by the server as metadata
 * (it is NOT used for the counts, which come from installId + count), so an
 * unreadable version costs nothing: fall back to 'unknown' rather than throw on
 * a path that must never throw.
 */
function version() {
  try { return String(require('../package.json').version || 'unknown'); }
  catch { return 'unknown'; }
}

/**
 * A short OS string for the same metadata slot. `os.release()` is the kernel
 * version (e.g. '25.6.0' on macOS Sequoia); paired with the platform it is
 * enough to tell macOS from Windows builds apart. Server clamps to 30 chars.
 */
function osTag() {
  try { return `${os.platform()} ${os.release()}`.trim(); }
  catch { return 'unknown'; }
}

/**
 * The payload for a `count`, matching the collector contract EXACTLY. `count` is
 * a non-negative integer (0 for the install ping, the total-ever-created count for
 * the created ping). installId falls back to 'unknown' the same way feedbacksend
 * does, so a one-off id-write failure never blocks the send.
 */
function payload(count) {
  let install = null;
  try { install = ping.installId(); } catch { install = null; }
  const n = Number.isInteger(count) && count >= 0 ? count : 0;
  return { installId: install || 'unknown', count: n, version: version(), os: osTag() };
}

/**
 * 🛑 A TEST RUN MUST NEVER PHONE HOME. `NODE_TEST_CONTEXT` is set by node's own
 * test runner in every test process and by nothing else, so it cannot be true
 * for a real install and cannot be false for a test -- the same signal ping.js /
 * feedbacksend.js settled on.
 */
function underTest() {
  return Boolean(process.env.NODE_TEST_CONTEXT);
}

/**
 * Fire ONE ping with a given count. Fire-and-forget: returns nothing, so no
 * future edit can make a caller wait on the network. A missing or down collector
 * (including a 404 before the route ships) loses nothing.
 */
function send(count) {
  try {
    /* Only guard the REAL network. A test that injected its own sender touches
       no network, so guarding it there would make the send path untestable --
       ping.js / feedbacksend.js's exact reasoning. */
    if (!sender && underTest()) return;
    const data = payload(count);
    const post = sender || ((url, init) => fetch(url, init));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    Promise.resolve(post(endpoint(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
      signal: ctl.signal,
    })).catch(() => { /* fire and forget: no collector, no problem */ })
      .finally(() => clearTimeout(timer));
  } catch { /* nothing here may reach the caller */ }
}

/**
 * The INSTALL ping: unconditional, count 0. Fired on board start so every
 * install -- including ones that predate this beacon -- registers itself and the
 * homepage install count reflects reality. Idempotent (count 0 + server Math.max
 * never lowers a real count), so firing it on every launch is safe.
 */
function pingInstall() { send(0); }

/**
 * The AGENT-CREATED ping: a count the CALLER supplies. The CALLER owns the
 * count AND the checkbox gate (the create route fires this only when the box is
 * on, and passes create.createdCount() -- the monotonic total-ever-created from
 * the birth log, #3038; it used to pass the live safeRoster count, which froze
 * the homepage number at peak-running under the server's Math.max). Keeping the
 * count derivation in ONE place -- the route -- is deliberate: an earlier version
 * also read the roster here (via a different, pane-based source), which is exactly the
 * two-derivations-of-one-fact defect the repo names as its worst habit. So this
 * takes the count and only sends; a missing or bad count is dropped rather than
 * re-derived from a second source.
 */
function pingAgentCreated(count) {
  if (!Number.isInteger(count) || count < 0) return;
  send(count);
}

/* Test hook. Production never calls this. */
function setSender(f) { sender = f; }

module.exports = {
  payload, send, pingInstall, pingAgentCreated,
  version, osTag, underTest, setSender, DEFAULT_ENDPOINT,
};
