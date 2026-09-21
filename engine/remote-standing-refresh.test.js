'use strict';

/**
 * Federation Kosmos+ gate, W1 refresh: remote.refreshStandingIfStale() (engine).
 *
 *   node --test engine/remote-standing-refresh.test.js
 *
 * ICK's v1 ruling: an enrolled board's `standing` is otherwise frozen at enrolment,
 * so a member who UPGRADES after enrolling could not see the feature until re-sign-in.
 * This lazily re-fetches standing when the cache is older than a TTL, so:
 *   - an UPGRADE (none -> good) takes effect within ~one TTL, no re-sign-in;
 *   - a LAPSE (good -> not) turns the UI off within ~one TTL (the 403 is the hard gate);
 *   - a fetch that CANNOT determine standing (offline/auth/not-wired-yet) keeps the
 *     last-known value -- no flicker -- and backs the retry off to the next TTL.
 * The actual coordinator fetch is isolated in fetchStanding() (pending ICK's mechanism);
 * this suite drives the refresh with an injected fetcher, the seam the real one plugs into.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-refresh-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-refresh-state-'));
process.env.AGENT_WORKFORCE_TUNNEL_STATE = STATE;
const remote = require('../engine/remote');

const TTL = 60000;
function enroll() { for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) fs.writeFileSync(path.join(STATE, f), 'x'); }
function unenroll() { for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) { try { fs.rmSync(path.join(STATE, f), { force: true }); } catch { /* ignore */ } } }
function writeSettings(o) { fs.mkdirSync(path.dirname(remote.FILE), { recursive: true }); fs.writeFileSync(remote.FILE, JSON.stringify(o) + '\n'); }

test('refresh: a NO-OP when the board is not enrolled (no account to check)', async () => {
  unenroll();
  writeSettings({ on: true, standing: 'good', standing_at: 1 });   // stale, but not enrolled
  let called = false;
  await remote.refreshStandingIfStale({ now: 10 ** 12, ttlMs: TTL, fetcher: async () => { called = true; return 'none'; } });
  assert.equal(called, false, 'not enrolled -> no fetch');
});

test('refresh: a NO-OP while the cache is still fresh (younger than the TTL)', async () => {
  enroll();
  writeSettings({ on: true, standing: 'good', standing_at: 1000 });
  let called = false;
  await remote.refreshStandingIfStale({ now: 1000 + 5000, ttlMs: TTL, fetcher: async () => { called = true; return 'none'; } });
  assert.equal(called, false, 'fresh cache -> no fetch');
  assert.equal(remote.kosmosPlus(), true, 'and the cached member value is served unchanged');
});

test('refresh: the UPGRADE case -- a stale non-member re-fetches good and becomes a member', async () => {
  enroll();
  writeSettings({ on: true, standing: 'none', standing_at: 1000 });   // paid AFTER enrolling
  assert.equal(remote.kosmosPlus(), false, 'precondition: not a member (enrolment-time)');
  await remote.refreshStandingIfStale({ now: 1000 + TTL + 1, ttlMs: TTL, fetcher: async () => 'good' });
  assert.equal(remote.kosmosPlus(), true, 'the upgrade takes effect within a TTL, no re-sign-in');
});

test('refresh: the LAPSE case -- a stale member re-fetches a non-good standing and drops', async () => {
  enroll();
  writeSettings({ on: true, standing: 'good', standing_at: 1000 });
  await remote.refreshStandingIfStale({ now: 1000 + TTL + 1, ttlMs: TTL, fetcher: async () => 'lapsed' });
  assert.equal(remote.kosmosPlus(), false, 'a lapse turns the UI off (the 403 is still the hard gate)');
});

test('refresh: a fetch that CANNOT determine (null) keeps the last-known value + backs off the retry', async () => {
  enroll();
  writeSettings({ on: true, standing: 'good', standing_at: 1000 });
  const before = remote.read().standing;
  await remote.refreshStandingIfStale({ now: 1000 + TTL + 1, ttlMs: TTL, fetcher: async () => null });
  assert.equal(remote.read().standing, before, 'null does NOT change the cached value (no flicker)');
  assert.equal(remote.kosmosPlus(), true, 'the member keeps seeing it');
  // standing_at was restamped (~now), so it will not re-fetch again until the next TTL.
  let called = false;
  await remote.refreshStandingIfStale({ now: 1000 + TTL + 2, ttlMs: TTL, fetcher: async () => { called = true; return 'good'; } });
  assert.equal(called, false, 'restamped -> the retry is backed off to the next TTL');
});

test('refresh: single-flighted -- concurrent polls do not stack fetches', async () => {
  enroll();
  writeSettings({ on: true, standing: 'none', standing_at: 1000 });
  let calls = 0;
  const slow = async () => { calls += 1; await new Promise((r) => setTimeout(r, 20)); return 'good'; };
  await Promise.all([
    remote.refreshStandingIfStale({ now: 10 ** 12, ttlMs: TTL, fetcher: slow }),
    remote.refreshStandingIfStale({ now: 10 ** 12, ttlMs: TTL, fetcher: slow }),
    remote.refreshStandingIfStale({ now: 10 ** 12, ttlMs: TTL, fetcher: slow }),
  ]);
  assert.equal(calls, 1, 'only one fetch ran despite three concurrent polls');
});

test('refresh: best-effort -- a throwing fetcher never propagates (a status tick must not see it)', async () => {
  enroll();
  writeSettings({ on: true, standing: 'good', standing_at: 1000 });
  await assert.doesNotReject(() => remote.refreshStandingIfStale({ now: 10 ** 12, ttlMs: TTL, fetcher: async () => { throw new Error('coordinator down'); } }));
  assert.equal(remote.kosmosPlus(), true, 'a failed refresh leaves the last-known value');
});

test('refresh: the SHIPPED default fetcher is a safe no-op today (source pending ICK) -- keeps the cache', async () => {
  enroll();
  writeSettings({ on: true, standing: 'good', standing_at: 1000 });
  // No injected fetcher -> the real fetchStanding() -> mac-standing, which under the
  // suite guard (NODE_TEST_CONTEXT, no injected transport) never dials and returns null.
  // This asserts the REFRESH's cache-preservation on a null fetch; that the guard itself
  // blocks a real dial is proven non-vacuously in engine/mac-standing.test.js.
  await remote.refreshStandingIfStale({ now: 10 ** 12, ttlMs: TTL });
  assert.equal(remote.kosmosPlus(), true, 'the enrolment-cache value is preserved (no-op refresh)');
});
