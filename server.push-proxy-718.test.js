'use strict';

/**
 * #718 (#3510): the board's /v1/push/* routes, driven against the real server
 * with a stub coordinator on loopback. The push client (#3520) calls these
 * same-origin; the coordinator owns the key pair and the subscriptions.
 *
 * What is guarded, by intent:
 *   - GET /v1/push/vapid-key returns the COORDINATOR's key, fetched from its
 *     /v1/push/vapid-key with no credential attached (the route is public there),
 *     so the static key the branch once carried cannot come back unnoticed.
 *   - The key is cached on success and a failure is NOT cached, so a coordinator
 *     that was briefly down is asked again.
 *   - A malformed key or a coordinator error is a 502 in plain words, never a
 *     200 carrying something PushManager.subscribe would choke on.
 *   - POST /v1/push/subscribe is an honest 501 until the token question on
 *     #3510 is ruled (see the comment at the route in server.js).
 *
 *   node --test server.push-proxy-718.test.js
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-push718-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

// A real P-256 point shape: 87 base64url characters.
const KEY = 'B' + 'A'.repeat(86);

// The stub coordinator. `answer` is swapped per test; every request is recorded.
const seen = [];
let answer = (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ key: KEY })); };
const coord = http.createServer((req, res) => { seen.push({ method: req.method, url: req.url, headers: req.headers }); answer(req, res); });

const test = require('node:test');
const assert = require('node:assert/strict');
const pushvapid = require('./engine/pushvapid');
const { start, server } = require('./server');
let base;
test.before(async () => {
  await new Promise((r) => coord.listen(0, '127.0.0.1', r));
  // A self-hosted prefix, so the path join is exercised too.
  process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR = `http://127.0.0.1:${coord.address().port}/kosmos`;
  // Inject the real transport: without an injected factory the suite guard refuses to dial.
  pushvapid.setRequestFactory((opts) => http.request(opts));
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.beforeEach(() => { pushvapid.clearCache(); seen.length = 0; });
test.after(async () => {
  pushvapid.setRequestFactory(null);
  server.closeAllConnections(); server.close(); coord.close();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

test('vapid-key returns the coordinator key, fetched with no credential attached', async () => {
  const res = await fetch(base + '/v1/push/vapid-key');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { key: KEY });
  assert.equal(seen.length, 1, 'the coordinator was not asked');
  assert.equal(seen[0].method, 'GET');
  assert.equal(seen[0].url, '/kosmos/v1/push/vapid-key', 'wrong coordinator path (or the prefix was dropped)');
  assert.equal(seen[0].headers.authorization, undefined, 'a credential was sent to a public route');
  assert.equal(seen[0].headers.cookie, undefined, 'the board cookie leaked to the coordinator');
});

test('a fetched key is cached; the coordinator is asked once', async () => {
  await fetch(base + '/v1/push/vapid-key');
  const res = await fetch(base + '/v1/push/vapid-key');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { key: KEY });
  assert.equal(seen.length, 1, 'the cache did not hold');
});

test('a coordinator error is a plain 502 and is not cached', async () => {
  answer = (req, res) => { res.writeHead(503); res.end('down'); };
  const res = await fetch(base + '/v1/push/vapid-key');
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /could not reach/);
  answer = (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ key: KEY })); };
  const again = await fetch(base + '/v1/push/vapid-key');
  assert.equal(again.status, 200, 'a failure was cached, so recovery never reached the client');
  assert.equal(seen.length, 2);
});

test('a malformed key is refused, never passed to the browser', async () => {
  for (const body of [JSON.stringify({ key: 'short' }), JSON.stringify({ key: KEY + '=' }), JSON.stringify({}), 'not json']) {
    pushvapid.clearCache();
    answer = (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(body); };
    const res = await fetch(base + '/v1/push/vapid-key');
    assert.equal(res.status, 502, `accepted a bad key body: ${body}`);
  }
  answer = (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ key: KEY })); };
});

test('subscribe is an honest 501 and never reaches the coordinator', async () => {
  const res = await fetch(base + '/v1/push/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: 'https://push.example/x', keys: { p256dh: 'p', auth: 'a' } }),
  });
  assert.equal(res.status, 501);
  assert.match((await res.json()).error, /cannot be turned on from here yet/);
  assert.equal(seen.length, 0, 'subscribe dialled the coordinator with no token to give it');
});

test('under node --test with no injected transport, the fetcher never dials', async () => {
  pushvapid.setRequestFactory(null);
  try {
    assert.equal(await pushvapid.fetchVapidKey(), null);
    assert.equal(seen.length, 0, 'the suite guard let a real dial through');
  } finally {
    pushvapid.setRequestFactory((opts) => http.request(opts));
  }
});
