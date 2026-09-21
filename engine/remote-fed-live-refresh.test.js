'use strict';

/**
 * Federation launch flag, option 2 (the CUSTOMER un-hide): remote.refreshFederationLiveIfStale()
 * and remote.federationLive() (engine).
 *
 *   node --test engine/remote-fed-live-refresh.test.js
 *
 * A customer cannot set an env var, so federationLive also comes from a GLOBAL "federation
 * live" bool the board caches from the coordinator, refreshed on a TTL from the /api/status
 * poll. This suite drives the refresh with an injected fetcher (the seam the real coordinator
 * fetch plugs into once ICK confirms the endpoint), and asserts:
 *   - flip ON  (false -> true)  within ~one TTL (the customer un-hide);
 *   - flip OFF (true  -> false) within ~one TTL (a lapse/rollback, no new release);
 *   - a fetch that CANNOT determine (null) KEEPS the last-known value -- no flicker;
 *   - it is GLOBAL: NOT gated on enrolment (unlike the per-account standing refresh), because a
 *     non-member board needs the flag to show the signup prompt;
 *   - default FALSE when unknown/unreadable (fail-safe: hidden until the coordinator says live);
 *   - single-flighted, and best-effort (a throwing fetcher never escapes).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fedlive-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fedlive-state-'));
process.env.AGENT_WORKFORCE_TUNNEL_STATE = STATE;
const remote = require('../engine/remote');

const TTL = 60000;
function enroll() { for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) fs.writeFileSync(path.join(STATE, f), 'x'); }
function unenroll() { for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) { try { fs.rmSync(path.join(STATE, f), { force: true }); } catch { /* ignore */ } } }
function writeSettings(o) { fs.mkdirSync(path.dirname(remote.FILE), { recursive: true }); fs.writeFileSync(remote.FILE, JSON.stringify(o) + '\n'); }

test('federationLive: default FALSE when nothing is cached (fail-safe: hidden)', () => {
  writeSettings({ on: true });                       // no fedLive field
  assert.equal(remote.federationLive(), false, 'unknown -> false');
});

test('refresh: flip ON -- a stale false re-fetches true (the CUSTOMER un-hide, within a TTL)', async () => {
  unenroll();                                         // a plain customer board, not enrolled in Kosmos+
  writeSettings({ on: true, fedLive: false, fedLive_at: 1000 });
  assert.equal(remote.federationLive(), false, 'precondition: hidden');
  await remote.refreshFederationLiveIfStale({ now: 1000 + TTL + 1, ttlMs: TTL, fetcher: async () => true });
  assert.equal(remote.federationLive(), true, 'federation goes live for the customer within a TTL, no env, no re-install');
});

test('refresh: it is GLOBAL -- it refreshes even when the board is NOT enrolled', async () => {
  unenroll();
  writeSettings({ on: true, fedLive: false, fedLive_at: 1000 });
  let called = false;
  await remote.refreshFederationLiveIfStale({ now: 1000 + TTL + 1, ttlMs: TTL, fetcher: async () => { called = true; return true; } });
  assert.equal(called, true, 'unlike the per-account standing refresh, a non-enrolled board still fetches the global flag');
  assert.equal(remote.federationLive(), true);
});

test('refresh: flip OFF -- a stale true re-fetches false (a lapse/rollback, within a TTL)', async () => {
  writeSettings({ on: true, fedLive: true, fedLive_at: 1000 });
  assert.equal(remote.federationLive(), true, 'precondition: live');
  await remote.refreshFederationLiveIfStale({ now: 1000 + TTL + 1, ttlMs: TTL, fetcher: async () => false });
  assert.equal(remote.federationLive(), false, 'a central rollback reaches the board within a TTL, no new release');
});

test('refresh: a NO-OP while the cache is still fresh (younger than the TTL)', async () => {
  writeSettings({ on: true, fedLive: true, fedLive_at: 1000 });
  let called = false;
  await remote.refreshFederationLiveIfStale({ now: 1000 + 5000, ttlMs: TTL, fetcher: async () => { called = true; return false; } });
  assert.equal(called, false, 'fresh cache -> no fetch');
  assert.equal(remote.federationLive(), true, 'and the cached value is served unchanged');
});

test('refresh: a fetch that CANNOT determine (null) KEEPS the last-known value + backs off', async () => {
  writeSettings({ on: true, fedLive: true, fedLive_at: 1000 });
  await remote.refreshFederationLiveIfStale({ now: 1000 + TTL + 1, ttlMs: TTL, fetcher: async () => null });
  assert.equal(remote.federationLive(), true, 'a transient failure keeps the last-known value (no flicker)');
  // and the clock was reset so the next poll is not stale-spamming the coordinator:
  const after = JSON.parse(fs.readFileSync(remote.FILE, 'utf8'));
  assert.ok(after.fedLive_at > 1000, 'fedLive_at was stamped forward to back the retry off');
});

test('refresh: single-flighted -- a second call while one is in flight does not stack a fetch', async () => {
  writeSettings({ on: true, fedLive: false, fedLive_at: 1000 });
  let calls = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const slow = async () => { calls++; await gate; return true; };
  const first = remote.refreshFederationLiveIfStale({ now: 1000 + TTL + 1, ttlMs: TTL, fetcher: slow });
  const second = remote.refreshFederationLiveIfStale({ now: 1000 + TTL + 1, ttlMs: TTL, fetcher: slow });
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 1, 'the in-flight guard prevents a stacked concurrent fetch');
});

test('refresh: best-effort -- a throwing fetcher never escapes the poll', async () => {
  writeSettings({ on: true, fedLive: true, fedLive_at: 1000 });
  await assert.doesNotReject(
    remote.refreshFederationLiveIfStale({ now: 1000 + TTL + 1, ttlMs: TTL, fetcher: async () => { throw new Error('coordinator down'); } }),
  );
  assert.equal(remote.federationLive(), true, 'and a throw leaves the last-known value untouched');
});

test('the shipped fetchFederationLive is a null STUB (pending ICK endpoint) -> default refresh is a safe no-op', async () => {
  writeSettings({ on: true, fedLive: false, fedLive_at: 1000 });
  // no injected fetcher: exercises the real default fetchFederationLive(), which is the null stub
  await remote.refreshFederationLiveIfStale({ now: 1000 + TTL + 1, ttlMs: TTL });
  assert.equal(remote.federationLive(), false, 'until ICK endpoint is wired, the flag stays at its default (false) -- env-only behaviour preserved');
});
