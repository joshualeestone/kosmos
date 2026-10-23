'use strict';
/* kosmos#6590 (S-7d branch c, c1a): the typed-code Allow's routes, against the real server with the engine's calls
   replaced so a call that got through is seen. Reading the waiting browsers needs a loopback connection no forwarder
   touched; acting on them also needs the request made on this computer (loopback Host and Origin) by a person at the
   screen. Under the board-v2 marker, Allow and Not me by device id are refused for anything but a listed computer. */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-typedallow-srv-6590-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TUNNEL_BIN = '/usr/bin/false';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server, REMOTE_NOT_ALLOWED } = require('./server');
const remote = require('./engine/remote');

let base;
let origin;
const calls = [];
let v2 = true;
let computers = new Set();
const real = {
  devicesWaiting: remote.devicesWaiting, deviceAllowCode: remote.deviceAllowCode, deviceDropWaiting: remote.deviceDropWaiting,
  devicesClearWaiting: remote.devicesClearWaiting, deviceAllow: remote.deviceAllow, deviceDeny: remote.deviceDeny,
  boardV2: remote.boardV2, listedAsComputer: remote.listedAsComputer,
};
remote.devicesWaiting = async () => { calls.push('waiting'); return { ok: true, because: null, data: { v2: true, count: 0, waiting: [], ctAlarm: false, ctFinding: null } }; };
remote.deviceAllowCode = async (k, c) => { calls.push('allow-code ' + k + ' ' + c); return { ok: false, because: 'That is not the code that browser shows. 2 more tries for it.', triesLeft: 2 }; };
remote.deviceDropWaiting = async (k) => { calls.push('drop ' + k); return { ok: true, because: null, data: { dropped: 1, allowed: false, device_id: null } }; };
remote.devicesClearWaiting = async () => { calls.push('clear'); return { ok: true, because: null, data: { cleared: 3 } }; };
remote.deviceAllow = async (id) => { calls.push('allow ' + id); return { ok: true, data: {} }; };
remote.deviceDeny = async (id) => { calls.push('deny ' + id); return { ok: true, data: {} }; };
remote.boardV2 = () => v2;
remote.listedAsComputer = (id) => computers.has(id);
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  origin = base;
});
test.after(() => {
  Object.assign(remote, real);
  server.closeAllConnections(); server.close();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const SCREEN = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' };
const VIA_PLUS = { 'x-forwarded-host': 'hers.kosmos.invalid', 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.9' };
const KNOCK = 'AbCdEfGhIjKlMnOpQrStUv';
const post = async (route, headers, body) => {
  const res = await fetch(base + route, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const get = async (route, headers = {}) => {
  const res = await fetch(base + route, { headers });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test('the waiting list: read on this computer, refused through Kosmos+ (either forwarder header)', async () => {
  calls.length = 0;
  let r = await get('/api/remote/waiting');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(calls, ['waiting'], 'a same-origin GET with no Origin header must still read it');
  for (const h of [VIA_PLUS, { 'x-forwarded-for': '203.0.113.9' }, { forwarded: 'for=203.0.113.9' }]) {
    calls.length = 0;
    r = await get('/api/remote/waiting', h);
    assert.equal(r.status, 403, JSON.stringify(h));
    assert.deepEqual(r.body, { ...REMOTE_NOT_ALLOWED.waiting });
    assert.deepEqual(calls, [], 'the engine was asked through a forwarder');
  }
});

test('allow, Not me and clear: only made on this computer, by a person at the screen', async () => {
  for (const [route, body, call] of [
    ['/api/remote/waiting/allow', { knockId: KNOCK, code: 'ABC-DEF' }, 'allow-code ' + KNOCK + ' ABC-DEF'],
    ['/api/remote/waiting/drop', { knockId: KNOCK }, 'drop ' + KNOCK],
    ['/api/remote/waiting/clear', {}, 'clear'],
  ]) {
    calls.length = 0;
    let r = await post(route, { ...SCREEN, origin, ...VIA_PLUS }, body);
    assert.equal(r.status, 403, route + ' through Kosmos+');
    assert.deepEqual(r.body, { ...REMOTE_NOT_ALLOWED.typedAllow });
    r = await post(route, SCREEN, body);
    assert.equal(r.status, 403, route + ' with no Origin is not shown to be made on this computer');
    r = await post(route, { ...SCREEN, origin: 'https://evil.example' }, body);
    assert.equal(r.status, 403, route + ' from a page on another origin');
    assert.deepEqual(calls, [], route + ': a refused request reached the engine');
    r = await post(route, { ...SCREEN, origin }, body);
    assert.deepEqual(calls, [call], route);
    if (route.endsWith('/allow')) {
      assert.equal(r.status, 400);
      assert.equal(r.body.triesLeft, 2);
      assert.match(r.body.error, /2 more tries/);
    } else {
      assert.equal(r.status, 200, JSON.stringify(r.body));
    }
  }
});

test('under the marker, Allow and Not me by id are refused for anything but a listed computer; Remove is not', async () => {
  v2 = true;
  computers = new Set(['dev-pc']);
  for (const verb of ['allow', 'deny']) {
    calls.length = 0;
    const r = await post('/api/remote/devices/' + verb, SCREEN, { device_id: 'dev-phone', code: '482 915' });
    assert.equal(r.status, 403, verb);
    assert.equal(r.body.code, 'typed_code_only');
    assert.deepEqual(calls, []);
    const ok = await post('/api/remote/devices/' + verb, SCREEN, { device_id: 'dev-pc', code: '482 915' });
    assert.equal(ok.status, 200, verb + ' a listed computer: ' + JSON.stringify(ok.body));
    assert.deepEqual(calls, [verb + ' dev-pc']);
  }
  v2 = false;
  calls.length = 0;
  const before = await post('/api/remote/devices/allow', SCREEN, { device_id: 'dev-phone' });
  assert.equal(before.status, 200, 'control: without the marker a phone is allowed by id as before');
  assert.deepEqual(calls, ['allow dev-phone']);
  v2 = true;
});
