'use strict';
/**
 * kosmos#7285 item 1, through the real POST /api/remote/devices/(remove|deny) route: on a Kosmos cloud machine, a remote
 * session may not remove or turn away the very browser it is (named by the tunnel's x-kosmos-session-key, else
 * x-kosmos-session-device). CONTROLS: another device, a computer that is not a cloud machine, a local request, and no
 * headers (an older tunnel) all reach the engine as before. The engine's verbs are stubbed (nothing reaches Kosmos+).
 *
 *   node --test server.cloudowndevice-7285.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cloudowndevice-7285-'));
process.env.HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(process.env.HOME, { recursive: true });
process.env.AGENT_WORKFORCE_HOME = process.env.HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const remote = require('./engine/remote');
const cm = require('./engine/cloudmachine');

let base;
const calls = [];
const real = { remove: remote.deviceRemove, deny: remote.deviceDeny, cloud: cm.isCloudMachine, v2: remote.boardV2 };
remote.deviceRemove = async (id) => { calls.push(['remove', id]); return { ok: true }; };
remote.deviceDeny = async (id) => { calls.push(['deny', id]); return { ok: true }; };
remote.boardV2 = () => false;   // the board-v2 rule for Not me is not under test here
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  remote.deviceRemove = real.remove; remote.deviceDeny = real.deny; cm.isCloudMachine = real.cloud; remote.boardV2 = real.v2;
  server.closeAllConnections(); server.close();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});
const PAGE = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' };
const VIA_PLUS = { ...PAGE, 'x-forwarded-host': 'hers.kosmos.invalid', 'x-forwarded-for': '203.0.113.9' };
const SESSION = { 'x-kosmos-session-key': 'k1.mine', 'x-kosmos-session-device': 'd-mine' };
const post = async (verb, id, headers) => {
  const res = await fetch(base + '/api/remote/devices/' + verb, { method: 'POST', headers, body: JSON.stringify({ device_id: id }) });
  return { status: res.status, body: await res.json() };
};

test('#7285: on a cloud machine, Remove or Not me on the requesting browser itself is refused, by key or by device', async () => {
  cm.isCloudMachine = () => true;
  calls.length = 0;
  for (const [verb, id] of [['remove', 'k1.mine'], ['deny', 'k1.mine'], ['remove', 'd-mine'], ['deny', 'd-mine']]) {
    const got = await post(verb, id, { ...VIA_PLUS, ...SESSION });
    assert.equal(got.status, 409, verb + ' ' + id);
    assert.equal(got.body.code, 'own_device_cloud');
    assert.match(got.body.error, /no way back/);
  }
  // A comma-joined copy: any piece counts (review 1).
  assert.equal((await post('remove', 'k1.mine', { ...VIA_PLUS, 'x-kosmos-session-key': 'k1.other, k1.mine' })).status, 409);
  assert.deepEqual(calls, [], 'a refused request reached the engine');
});

test('#7285 CONTROLS: another device, not a cloud machine, a local request, and no session headers all go through', async () => {
  calls.length = 0;
  cm.isCloudMachine = () => true;
  assert.equal((await post('remove', 'k1.lost-phone', { ...VIA_PLUS, ...SESSION })).status, 200, 'another device');
  assert.equal((await post('remove', 'k1.mine', VIA_PLUS)).status, 200, 'an older tunnel: no headers, as before');
  assert.equal((await post('remove', 'k1.mine', { ...PAGE, ...SESSION })).status, 200, 'a local request');
  cm.isCloudMachine = () => false;
  assert.equal((await post('deny', 'k1.mine', { ...VIA_PLUS, ...SESSION })).status, 200, 'not a cloud machine');
  assert.deepEqual(calls, [['remove', 'k1.lost-phone'], ['remove', 'k1.mine'], ['remove', 'k1.mine'], ['deny', 'k1.mine']]);
});
