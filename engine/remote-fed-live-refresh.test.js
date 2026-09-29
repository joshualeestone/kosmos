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
 *   - it is NOT gated on enrolment (unlike the per-account standing refresh): a board with remote
 *     access on that is not signed in yet still learns it; but it IS gated on remote access being on
 *     (kosmos#4649, decided): a board that never opted in makes no call and the flag reads false;
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

test('refresh: NOT gated on enrolment -- a board with remote access on refreshes before it is signed in', async () => {
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

/* kosmos#4649: the real fetch, against a real HTTP server standing in for the coordinator (the
   app finds it through AGENT_WORKFORCE_TUNNEL_COORDINATOR, as every other coordinator call does). */
const http = require('node:http');
async function withMeta(answer, fn) {
  const server = http.createServer((req, res) => {
    if (req.url !== '/v1/meta') { res.writeHead(404); res.end(); return; }
    if (answer === 'hang') return;                          // never answers: the timeout arm
    if (typeof answer === 'number') { res.writeHead(answer); res.end('{}'); return; }
    if (answer && answer.redirectTo) { res.writeHead(302, { location: answer.redirectTo }); res.end(); return; }
    if (answer && answer.html) { res.writeHead(200, { 'content-type': 'text/html' }); res.end('{"federation_live":true}'); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(typeof answer === 'string' ? answer : JSON.stringify(answer));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const was = process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR;
  process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR = 'http://127.0.0.1:' + server.address().port + '/';
  try { return await fn(); } finally {
    if (was === undefined) delete process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR; else process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR = was;
    server.closeAllConnections(); await new Promise((r) => server.close(r));
  }
}

test('#4649 fetchFederationLive reads federation_live off the coordinator\'s public /v1/meta', async () => {
  const meta = { build: 'x', domain: 'kosmosplus.com' };
  assert.equal(await withMeta({ ...meta, federation_live: true }, () => remote.fetchFederationLive()), true);
  assert.equal(await withMeta({ ...meta, federation_live: false }, () => remote.fetchFederationLive()), false);
});

test('#4649 fetchFederationLive answers null (cannot tell) for every answer that is not a boolean flag', async () => {
  // Today's coordinator: no field. Then a non-boolean, an error status, unreadable JSON, and silence.
  assert.equal(await withMeta({ build: 'b77a85c', domain: 'kosmosplus.com' }, () => remote.fetchFederationLive()), null);
  assert.equal(await withMeta({ federation_live: 'yes' }, () => remote.fetchFederationLive()), null);
  assert.equal(await withMeta(503, () => remote.fetchFederationLive()), null);
  assert.equal(await withMeta('not json', () => remote.fetchFederationLive()), null);
  assert.equal(await withMeta('hang', () => remote.fetchFederationLive({ timeoutMs: 200 })), null);
  // And with nothing listening at all.
  const was = process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR;
  process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR = 'http://127.0.0.1:9';
  try { assert.equal(await remote.fetchFederationLive({ timeoutMs: 500 }), null); } finally {
    if (was === undefined) delete process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR; else process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR = was;
  }
});

test('#4649 end to end: the default refresh flips the flag from the coordinator, and a coordinator without the field changes nothing', async () => {
  writeSettings({ on: true, fedLive: false, fedLive_at: 1000 });
  await withMeta({ federation_live: true }, () => remote.refreshFederationLiveIfStale({ now: 1000 + TTL + 1, ttlMs: TTL }));
  assert.equal(remote.federationLive(), true, 'the coordinator said live, and the default refresh did not take it');
  writeSettings({ on: true, fedLive: true, fedLive_at: 1000 });
  await withMeta({ build: 'b77a85c' }, () => remote.refreshFederationLiveIfStale({ now: 1000 + TTL + 1, ttlMs: TTL }));
  assert.equal(remote.federationLive(), true, 'a coordinator without the field must keep the last-known value');
});

test('#4649 decided: a board whose person has NOT turned remote access on never asks the coordinator', async () => {
  for (const settings of [{ on: false, fedLive: false, fedLive_at: 1000 }, { fedLive: false, fedLive_at: 1000 }]) {
    writeSettings(settings);
    let called = false;
    await remote.refreshFederationLiveIfStale({ now: 1000 + TTL + 1, ttlMs: TTL, fetcher: async () => { called = true; return true; } });
    assert.equal(called, false, 'a board that never opted in called our servers: ' + JSON.stringify(settings));
    assert.equal(remote.federationLive(), false);
  }
});

test('#4649 a redirect is refused and a non-JSON answer is ignored (null), even when it reads true', async () => {
  // The redirect's target stays up and answers true, so a followed redirect would read true, not null.
  const target = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"federation_live":true}'); });
  await new Promise((r) => target.listen(0, '127.0.0.1', r));
  try {
    const to = 'http://127.0.0.1:' + target.address().port + '/v1/meta';
    assert.equal(await withMeta({ redirectTo: to }, () => remote.fetchFederationLive()), null, 'a redirect was followed');
  } finally { target.closeAllConnections(); await new Promise((r) => target.close(r)); }
  assert.equal(await withMeta({ html: true }, () => remote.fetchFederationLive()), null, 'a non-JSON answer was parsed');
});

test('#4649 round 2: a cached true does not outlive remote access being turned off', () => {
  writeSettings({ on: true, fedLive: true, fedLive_at: 1000 });
  assert.equal(remote.federationLive(), true, 'control: on, and the coordinator said true');
  writeSettings({ on: false, fedLive: true, fedLive_at: 1000 });
  assert.equal(remote.federationLive(), false, 'remote access is off, so a stale true must not show the screens');
});
