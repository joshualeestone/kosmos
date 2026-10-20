'use strict';
/* kosmos#6595: the board knows when a request arrives through Kosmos+ remote access (the tunnel sets x-forwarded-for
   on every request it forwards and x-forwarded-host on all but a webhook, writing over any value a client sent, per
   kosmos-relay crates/tunnel/src/proxy.rs (forward, forward_hook); not checked from this repo), and a device cannot
   be allowed from a remote session, nor an agent token minted from one. Against the real server, with the engine's
   allow, confirm, deny and remove and the token mint replaced so a call that got through is seen. */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-remotemark-6595-'));
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
const { start, server, isRemoteRequest, REMOTE_NOT_ALLOWED } = require('./server');
const remote = require('./engine/remote');
const sendertoken = require('./engine/sendertoken');

let base;
const calls = [];
const real = { deviceAllow: remote.deviceAllow, deviceDeny: remote.deviceDeny, deviceRemove: remote.deviceRemove, joinConfirm: remote.joinConfirm };
const realMint = sendertoken.mint;
sendertoken.mint = (name) => { calls.push('mint ' + name); return { ok: true, token: 't'.repeat(64), instance: 'i1' }; };
remote.deviceRemove = async (id) => { calls.push('remove ' + id); return { ok: true, data: {} }; };
remote.deviceAllow = async (id) => { calls.push('allow ' + id); return { ok: true, data: {} }; };
remote.deviceDeny = async (id) => { calls.push('deny ' + id); return { ok: true, data: {} }; };
remote.joinConfirm = async (code) => { calls.push('confirm ' + code); return { ok: true, data: {} }; };
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  Object.assign(remote, real);
  sendertoken.mint = realMint;
  server.closeAllConnections(); server.close();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const PAGE = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' };
const VIA_PLUS = { ...PAGE, 'x-forwarded-host': 'hers.kosmos.invalid', 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.9' };
const post = async (route, headers, body) => {
  const res = await fetch(base + route, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const GUARDED_ROUTES = [
  ['/api/remote/devices/allow', { device_id: 'dev1', code: '482 915' }, 'allow dev1', REMOTE_NOT_ALLOWED.allow],
  ['/api/remote/join/confirm', { code: '482 915' }, 'confirm 482 915', REMOTE_NOT_ALLOWED.joinConfirm],
  ['/api/agent-token', { name: 'win-helper' }, 'mint win-helper', REMOTE_NOT_ALLOWED.agentToken],
];
/* The tunnel sets x-forwarded-for on every request it forwards and x-forwarded-host on all but a webhook; either one
   alone, or Forwarded, reads as remote. */
const ONE_HEADER = [
  ['x-forwarded-host', 'hers.kosmos.invalid'],
  ['x-forwarded-for', '203.0.113.9'],
  ['forwarded', 'for=203.0.113.9'],
];

for (const [route, body, call, refusal] of GUARDED_ROUTES) {
  test(`#6595: ${route} through Kosmos+ is refused with remote_not_allowed and reaches nothing (no allow, no confirm, no token)`, async () => {
    calls.length = 0;
    const got = await post(route, VIA_PLUS, body);
    assert.equal(got.status, 403, route + ' answered ' + JSON.stringify(got.body));
    assert.equal(got.body.code, 'remote_not_allowed');
    assert.equal(got.body.error, refusal.error, 'the refusal is not the one for ' + route);
    assert.deepEqual(calls, [], 'a remote session reached the engine');
    for (const [name, value] of ONE_HEADER) {
      const one = await post(route, { ...PAGE, [name]: value }, body);
      assert.equal(one.status, 403, route + ' with only ' + name + ' answered ' + JSON.stringify(one.body));
      assert.equal(one.body.code, 'remote_not_allowed', name);
      assert.deepEqual(calls, [], 'a request with only ' + name + ' reached the engine');
    }
  });
  test(`#6595 CONTROL: the same ${route} request made locally is not refused for being remote`, async () => {
    calls.length = 0;
    const got = await post(route, PAGE, body);
    assert.equal(got.status, 200, route + ' answered ' + JSON.stringify(got.body));
    assert.notEqual(got.body && got.body.code, 'remote_not_allowed');
    assert.deepEqual(calls, [call], 'the local request did not reach the engine');
  });
}

test('#6595: an EMPTY x-forwarded-for or Forwarded, sent over HTTP, still refuses a guarded route', async () => {
  for (const name of ['x-forwarded-for', 'forwarded']) {
    calls.length = 0;
    const got = await post('/api/remote/devices/allow', { ...PAGE, [name]: '' }, { device_id: 'dev3' });
    assert.equal(got.status, 403, 'empty ' + name + ' answered ' + JSON.stringify(got.body));
    assert.equal(got.body.error, REMOTE_NOT_ALLOWED.allow.error, name);
    assert.deepEqual(calls, [], 'an empty ' + name + ' reached the engine');
  }
  calls.length = 0;
  const control = await post('/api/remote/devices/allow', PAGE, { device_id: 'dev3' });
  assert.equal(control.status, 200, 'CONTROL: ' + JSON.stringify(control.body));
  assert.deepEqual(calls, ['allow dev3'], 'CONTROL: no header did not reach the engine');
});

for (const verb of ['deny', 'remove']) {
  test(`#6595: ${verb} still works from a remote session (it only takes access away), so only Allow is guarded`, async () => {
    calls.length = 0;
    const got = await post('/api/remote/devices/' + verb, VIA_PLUS, { device_id: 'dev2' });
    assert.equal(got.status, 200, JSON.stringify(got.body));
    assert.deepEqual(calls, [verb + ' dev2']);
  });
}

test('#6595: isRemoteRequest reads any forwarding header that is present, even empty, and nothing else', () => {
  const r = (headers) => isRemoteRequest({ headers });
  for (const [name, value] of ONE_HEADER) {
    assert.equal(r({ [name]: value }), true, name + ' present');
    assert.equal(r({ [name]: '' }), true, name + ' empty is still forwarded');
    assert.equal(r({ [name]: '   ' }), true, name + ' blank is still forwarded');
  }
  assert.equal(r({ 'x-forwarded-host': 'anything' }), true, 'any value counts');
  assert.equal(r({}), false, 'absent');
  assert.equal(r({ host: '127.0.0.1:4317', origin: 'http://127.0.0.1:4317' }), false, 'a local page');
  assert.equal(isRemoteRequest(undefined), false, 'no request');
  assert.equal(isRemoteRequest({}), false, 'no headers');
});

test('#6595: madeOnThisComputer shares the reading: a forwarded request is never made on this computer', () => {
  const { madeOnThisComputer, cameThroughForwarder } = require('./server');
  const here = { host: '127.0.0.1:16180', origin: 'http://127.0.0.1:16180' };
  assert.equal(madeOnThisComputer(here), true, 'CONTROL: the app window');
  assert.equal(cameThroughForwarder(here), false);
  for (const [name, value] of ONE_HEADER) {
    assert.equal(madeOnThisComputer({ ...here, [name]: value }), false, name);
    assert.equal(cameThroughForwarder({ ...here, [name]: value }), true, name);
  }
});

test('#6595: an EMPTY x-forwarded-for or Forwarded is not made on this computer (the open-ticket rule)', () => {
  const { madeOnThisComputer } = require('./server');
  const here = { host: '127.0.0.1:16180', origin: 'http://127.0.0.1:16180' };
  assert.equal(madeOnThisComputer(here), true, 'CONTROL: no forwarding header');
  assert.equal(madeOnThisComputer({ ...here, 'x-forwarded-for': '' }), false, 'empty x-forwarded-for read as local');
  assert.equal(madeOnThisComputer({ ...here, forwarded: '' }), false, 'empty Forwarded read as local');
  assert.equal(madeOnThisComputer({ ...here, 'x-forwarded-host': '' }), false, 'empty x-forwarded-host read as local');
});
