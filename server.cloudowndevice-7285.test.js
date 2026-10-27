'use strict';
/**
 * kosmos#7285 item 1, through the real POST /api/remote/devices/(remove|deny) route: on a Kosmos cloud machine, a remote
 * session may not remove or turn away the very browser it is (named by the tunnel's x-kosmos-session-key or
 * x-kosmos-session-device; the key is also compared with every key holding a row). CONTROLS: another device, a computer that is not a cloud machine, a local request, and no
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
const real = { remove: remote.deviceRemove, deny: remote.deviceDeny, cloud: cm.isCloudMachine, v2: remote.boardV2, list: remote.devicesList };
remote.deviceRemove = async (id) => { calls.push(['remove', id]); return { ok: true }; };
remote.deviceDeny = async (id) => { calls.push(['deny', id]); return { ok: true }; };
remote.boardV2 = () => false;   // the board-v2 rule for Not me is not under test here
// The tunnel's list, as the board reads it (engine/remote.js devicesList): each row's device id and every key holding it.
let LIST = { ok: true, data: { devices: [] } };
let listReads = 0;
remote.devicesList = async () => { listReads += 1; return LIST; };
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  remote.deviceRemove = real.remove; remote.deviceDeny = real.deny; cm.isCloudMachine = real.cloud; remote.boardV2 = real.v2;
  remote.devicesList = real.list;
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

test('#7285 follow-up (PigeonPete): a row held by the requesting session\'s KEYS is refused too, even when its id is not the session\'s device', async () => {
  cm.isCloudMachine = () => true;
  calls.length = 0;
  LIST = { ok: true, data: { devices: [
    { device_id: 'd-sibling', keys: ['k1.mine'] },                // another id held by the same key: removing it locks this browser out
    { device_id: 'd-shared', keys: ['k1.someone', 'k1.mine'] },   // held by several keys, this browser's NOT first
    { device_id: 'd-other', keys: ['k1.someone'] },              // a different key
    { device_id: 'd-nokey', keys: [] },                          // no key holds it
  ] } };
  for (const verb of ['remove', 'deny']) {
    const got = await post(verb, 'd-sibling', { ...VIA_PLUS, ...SESSION });
    assert.equal(got.status, 409, verb + ' sibling');
    assert.equal(got.body.code, 'own_device_cloud');
  }
  // Removing an id deletes EVERY key holding it, so a row whose second key is this browser's is refused too.
  for (const verb of ['remove', 'deny']) {
    assert.equal((await post(verb, 'd-shared', { ...VIA_PLUS, ...SESSION })).status, 409, verb + ': a row this key holds, not first');
  }
  // This browser's own id dropped off its key's list (a key holds at most 16): the session's device header names an id
  // no row has, and the row the person picks is still held by the session's key.
  assert.equal((await post('remove', 'd-sibling', { ...VIA_PLUS, 'x-kosmos-session-key': 'k1.mine', 'x-kosmos-session-device': 'd-gone' })).status, 409);
  assert.deepEqual(calls, [], 'a refused request reached the engine');
});

test('#7285 follow-up CONTROLS: a different key, a row with no key, and no key header go through; the list is read only with a key header', async () => {
  cm.isCloudMachine = () => true;
  calls.length = 0;
  LIST = { ok: true, data: { devices: [{ device_id: 'd-sibling', keys: ['k1.mine'] }, { device_id: 'd-other', keys: ['k1.someone'] }, { device_id: 'd-nokey', keys: [] }, { device_id: 'd-nokeys' }] } };
  assert.equal((await post('remove', 'd-other', { ...VIA_PLUS, ...SESSION })).status, 200, 'a row held by another key');
  assert.equal((await post('remove', 'd-nokey', { ...VIA_PLUS, ...SESSION })).status, 200, 'a row with no key');
  assert.equal((await post('remove', 'd-nokeys', { ...VIA_PLUS, ...SESSION })).status, 200, 'a row with keys absent (an older tunnel)');
  assert.equal((await post('remove', 'd-unlisted', { ...VIA_PLUS, ...SESSION })).status, 200, 'an id the list does not have');
  listReads = 0;
  assert.equal((await post('remove', 'd-sibling', { ...VIA_PLUS, 'x-kosmos-session-device': 'd-mine' })).status, 200, 'no key header: the device id alone decides');
  assert.equal(listReads, 0, 'the list is not read without a key header');
  assert.deepEqual(calls, [['remove', 'd-other'], ['remove', 'd-nokey'], ['remove', 'd-nokeys'], ['remove', 'd-unlisted'], ['remove', 'd-sibling']]);
});

test('#7285 follow-up: a list that cannot be read, with a key header, refuses and says it could not check', async () => {
  cm.isCloudMachine = () => true;
  calls.length = 0;
  LIST = { ok: false, because: 'the tunnel did not answer' };
  const got = await post('remove', 'd-sibling', { ...VIA_PLUS, ...SESSION });
  assert.equal(got.status, 409);
  assert.equal(got.body.code, 'own_device_cloud_unknown');
  assert.match(got.body.error, /could not check/);
  remote.devicesList = async () => { throw new Error('boom'); };
  assert.equal((await post('deny', 'd-sibling', { ...VIA_PLUS, ...SESSION })).status, 409, 'a thrown read refuses too');
  remote.devicesList = async () => { listReads += 1; return LIST; };
  assert.deepEqual(calls, []);
});

test('#7285 review 1: GET /api/remote/devices does not hand the rows\' keys to the page', async () => {
  LIST = { ok: true, data: { devices: [{ device_id: 'd-sibling', name: 'phone', keys: ['k1.mine'] }] } };
  const res = await fetch(base + '/api/remote/devices', { headers: PAGE });
  const body = await res.json();
  assert.equal(res.status, 200);
  const row = (body.allowed || []).find((d) => d.device_id === 'd-sibling');
  assert.ok(row, 'CONTROL: the row itself is listed: ' + JSON.stringify(body));
  assert.equal(row.name, 'phone');
  assert.equal('keys' in row, false, 'keys reached the page');
});
