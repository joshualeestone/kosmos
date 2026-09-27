'use strict';

/**
 * #718: the ship gate (Liu Kang, 2026-09-24). While engine/phonenotify.js's gate is
 * closed, the setting reads unavailable, turning on is refused, and nothing is sent
 * even when the switch file says on with a token.
 * #4194: the gate now SHIPS OPEN (a receiving Android test app exists). The first test
 * pins that. The closed-gate tests stay, closing it explicitly with
 * setAvailableForTests(false), because the lock is how a release would close it again
 * and it must still hold; the last test shows the same state and actions do send with
 * the gate open, so the zeros are the gate's and not the harness's.
 *
 *   node --test server.phonenotify-gate-718.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-718gate-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
const STATE = path.join(SANDBOX, 'remote');
process.env.AGENT_WORKFORCE_TUNNEL_STATE = STATE;
process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR = 'https://coord.example.test';
const TUNNEL_LOG = path.join(SANDBOX, 'tunnel.log');
const FAKE_TUNNEL = path.join(SANDBOX, 'fake-kosmos-tunnel');
fs.writeFileSync(FAKE_TUNNEL, `#!/bin/bash\ncat >/dev/null; echo ran >> "${TUNNEL_LOG}"; printf '{"token":"knt1_gatetoken01234"}\\n'\n`, { mode: 0o755 });
process.env.AGENT_WORKFORCE_TUNNEL_BIN = FAKE_TUNNEL;

const { start, server, boardAuthState } = require('./server');
const fleet = require('./test-support/fleet');
const messages = require('./engine/messages');
const sendertoken = require('./engine/sendertoken');
const phonenotify = require('./engine/phonenotify');
const selfreport = require('./engine/selfreport');

let base;
const sent = [];
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  boardAuthState.on = false;
  phonenotify.setSender((url, headers, body) => sent.push(JSON.parse(body)));
  fs.mkdirSync(STATE, { recursive: true });
  for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) fs.writeFileSync(path.join(STATE, f), 'x');
  // A switch already on with a token, as if written before the gate closed.
  fs.writeFileSync(path.join(STATE, 'phone-notify.json'), JSON.stringify({ on: true, notifyId: 'n1', token: 'knt1_heldtoken0123' }));
});
test.after(() => {
  phonenotify.setSender(null);
  server.closeAllConnections(); server.close();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

async function call(method, p, { headers = {}, body } = {}) {
  const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = {}; try { json = JSON.parse(text); } catch { /* not json */ }
  return { code: res.status, json, text };
}
async function actAsLeo() {
  // Each run starts from no report, so the fixture can arrange "idle".
  for (const dir of [selfreport.DIR, sendertoken.DIR]) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* not there yet */ }
  }
  phonenotify.resetCooldownForTests();
  const board = fleet.install([fleet.agent('leo', { state: 'idle' })]);
  messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
  const h = { 'x-kosmos-agent-token': sendertoken.mint('leo').token };
  try {
    await call('POST', '/api/report', { headers: h, body: { state: 'working', text: 'x' } });
    await call('POST', '/api/report', { headers: h, body: { state: 'needs_you', text: 'x' } });
    await call('POST', '/api/reply', { headers: h, body: { text: 'x' } });
  } finally { sendertoken.revoke('leo'); messages.setRunner(null); board.restore(); }
}

test('#4194: the gate ships OPEN in this commit (a receiving phone app exists)', () => {
  assert.equal(phonenotify.PHONE_APP_CAN_RECEIVE, true, 'the ship gate is closed; #4194 opens it for the release after Josh says yes');
});

test('#4194: with the gate open as shipped, the setting reads available (the module default, nothing set by the test)', async () => {
  const st = await call('GET', '/api/phone-notify');
  assert.equal(st.json.available, true, JSON.stringify(st.json));
});

/* The lock itself (a release could close the gate again): closed explicitly for these tests. */
test('gate closed: the setting reads unavailable and off, whatever the file says', async () => {
  phonenotify.setAvailableForTests(false);
  const st = await call('GET', '/api/phone-notify');
  assert.deepEqual(st.json, { available: false, on: false, connected: true });
});

test('gate closed: turning on is refused and the tunnel never runs', async () => {
  phonenotify.setAvailableForTests(false);
  const r = await call('PUT', '/api/phone-notify', { body: { on: true } });
  assert.equal(r.code, 400);
  assert.match(r.json.error, /not available yet/);
  assert.equal(fs.existsSync(TUNNEL_LOG), false);
});

test('gate closed: nothing is sent, even with the switch file on and a token held', async () => {
  phonenotify.setAvailableForTests(false);
  sent.length = 0;
  await actAsLeo();
  assert.equal(sent.length, 0, 'a notification left the Mac while the ship gate was closed');
});

test('CONTROL: gate open, the same state and actions do send', async () => {
  sent.length = 0;
  phonenotify.setAvailableForTests(true);
  try {
    await actAsLeo();
    assert.equal(sent.length, 2, 'the control sent nothing, so the zero above proves nothing');
    const st = await call('GET', '/api/phone-notify');
    assert.equal(st.json.available, true);
  } finally { phonenotify.setAvailableForTests(phonenotify.PHONE_APP_CAN_RECEIVE); }
});
