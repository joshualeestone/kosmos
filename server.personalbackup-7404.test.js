'use strict';
/**
 * kosmos#7404 (backupscreens-7404): the board's personal backup routes. None exists while the board's switch is off;
 * every one is the person's (an agent token is refused); the ones that move a key or end a membership need a fresh
 * step-up from a remote session. The sandbox has no Kosmos+ identity, so nothing here reaches a coordinator.
 */
require('./test-support/tmpscope');   // first, so every temp dir this file makes is contained and removed
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pb-7404-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pb-7404-home-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pb-7404-work-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pb-7404-proj-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pb-7404-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
delete process.env.KOSMOS_PERSONAL_BACKUP;
delete process.env.KOSMOS_PERSONAL_BACKUP_PRICE;

const { start, server, needsRemoteStepUp } = require('./server');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const store = require('./engine/store');

test.before(async () => { await start(0); });
test.after(() => {
  server.closeAllConnections(); server.close();
  for (const d of [SANDBOX, process.env.HOME, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS, process.env.AGENT_WORKFORCE_LAUNCH]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* gone */ }
  }
});

async function call(p, { method = 'POST', body, headers } = {}) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${p}`, {
    method, headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null; try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}
const SCREEN = { 'sec-fetch-site': 'same-origin' };
const POSTS = ['preview', 'on', 'key', 'saved', 'restore', 'off'].map((k) => '/api/personal-backup/' + k);
function offerOn(t, price) {
  process.env.KOSMOS_PERSONAL_BACKUP = '1';
  if (price === undefined) delete process.env.KOSMOS_PERSONAL_BACKUP_PRICE; else process.env.KOSMOS_PERSONAL_BACKUP_PRICE = price;
  t.after(() => { delete process.env.KOSMOS_PERSONAL_BACKUP; delete process.env.KOSMOS_PERSONAL_BACKUP_PRICE; });
}

test('#7404: with the switch off there is no surface: every route answers 404, even from the screen', async () => {
  assert.ok(store.ROOT.startsWith(SANDBOX), 'not sandboxed: ' + store.ROOT);
  const g = await call('/api/personal-backup', { method: 'GET', headers: SCREEN });
  assert.equal(g.status, 404, JSON.stringify(g));
  for (const p of POSTS) assert.equal((await call(p, { body: {}, headers: SCREEN })).status, 404, p);
});

test('#7404: switch on, an agent is refused on every route', async (t) => {
  offerOn(t);
  const b = fleet.install([fleet.agent('leo', { state: 'idle' })]);
  t.after(() => b.restore());
  const asLeo = { 'x-kosmos-agent-token': sendertoken.mint('leo').token };
  assert.equal((await call('/api/personal-backup', { method: 'GET', headers: asLeo })).status, 403);
  for (const p of POSTS) {
    const r = await call(p, { body: { ticket: 'x', accepted: true, code: 'K7QD-3MXA-9VPE-H2NW-4TBR-6YC8-JF' }, headers: asLeo });
    assert.equal(r.status, 403, p + ' answered an agent: ' + JSON.stringify(r));
  }
});

test('#7404: GET answers shown, the price (only in Stripe shape) and the state, from the screen', async (t) => {
  offerOn(t, '$5/month');
  let g = await call('/api/personal-backup', { method: 'GET', headers: SCREEN });
  assert.deepEqual(g.json, { shown: true, price: '$5/month', state: 'off' });
  process.env.KOSMOS_PERSONAL_BACKUP_PRICE = 'five dollars';
  g = await call('/api/personal-backup', { method: 'GET', headers: SCREEN });
  assert.deepEqual(g.json, { shown: true, price: null, state: 'off' });
});

test('#7404: with no price set, nothing can be previewed or turned on (there is nothing to agree to)', async (t) => {
  offerOn(t);
  for (const k of ['preview', 'on']) {
    const r = await call('/api/personal-backup/' + k, { body: { ticket: 'x', accepted: true }, headers: SCREEN });
    assert.equal(r.json.ok, false, k); assert.equal(r.json.code, 'no_price', k + ': ' + JSON.stringify(r.json));
  }
  process.env.KOSMOS_PERSONAL_BACKUP_PRICE = 'soon';
  assert.equal((await call('/api/personal-backup/preview', { body: {}, headers: SCREEN })).json.code, 'no_price');
  // Restore and turn off are not a charge, so they work without a price.
  // Personal backup is not on in the sandbox, so the engine refuses before reading the code (not_on), with no price too.
  assert.equal((await call('/api/personal-backup/restore', { body: { code: 'x' }, headers: SCREEN })).json.code, 'not_on');
});

test('#7404: from the screen, a decline turns nothing on; a bad code restores nothing; an unknown step is 404', async (t) => {
  offerOn(t, '$5/month');
  const no = await call('/api/personal-backup/on', { body: { ticket: 'nope', accepted: false }, headers: SCREEN });
  assert.equal(no.json.ok, false); assert.equal(no.json.declined, true, JSON.stringify(no.json));
  const stale = await call('/api/personal-backup/on', { body: { ticket: 'nope', accepted: true }, headers: SCREEN });
  assert.equal(stale.json.ok, false); assert.equal(stale.json.code, 'ticket', JSON.stringify(stale.json));
  const bad = await call('/api/personal-backup/restore', { body: { code: 'not a code' }, headers: SCREEN });
  // Challenge round 5: a restore needs personal backup on here; the sandbox has none, so nothing is read.
  assert.equal(bad.json.ok, false); assert.equal(bad.json.code, 'not_on', JSON.stringify(bad.json));
  const notText = await call('/api/personal-backup/restore', { body: { code: 12345 }, headers: SCREEN });
  assert.equal(notText.json.code, 'not_a_code');
  // Not connected to Kosmos+ in the sandbox: the preview is refused before any tunnel, in words.
  const pv = await call('/api/personal-backup/preview', { body: {}, headers: SCREEN });
  assert.equal(pv.json.ok, false); assert.match(pv.json.because, /Kosmos\+/, JSON.stringify(pv.json));
  assert.equal((await call('/api/personal-backup/whatever', { body: {}, headers: SCREEN })).status, 404);
  // Challenge round 3: the bare path is GET only; a POST there once fell through to turning backup off.
  const pbm = require('./engine/personalbackup'); const realOff = pbm.switchOff; let offCalls = 0;
  pbm.switchOff = async () => { offCalls++; return { ok: true }; };
  try {
    for (const m of ['POST', 'PUT', 'DELETE']) assert.equal((await call('/api/personal-backup', { method: m, body: {}, headers: SCREEN })).status, 404, m);
  } finally { pbm.switchOff = realOff; }
  assert.equal(offCalls, 0, 'a request to the bare path reached switchOff');
  assert.equal((await call('/api/personal-backup/on', { method: 'GET', headers: SCREEN })).status, 404);
  assert.equal(fs.existsSync(path.join(store.ROOT, 'personal-backup', 'enrollment.json')), false);
});

test('#7404: every step needs a step-up (preview makes a membership; saved deletes what may be the only copy of the code)', () => {
  for (const k of ['preview', 'on', 'key', 'restore', 'off', 'saved']) assert.equal(needsRemoteStepUp('/api/personal-backup/' + k, 'POST'), true, k);
  assert.equal(needsRemoteStepUp('/api/personal-backup', 'GET'), false);
});

/* Challenge round 1: the answer the screen needs passes through the route's named-field list, and nothing else does.
   The engine modules are shared objects (the route requires them per call), so their functions are swapped here and put
   back after. */
test('#7404: on and key pass the recovery code, org and member to the screen; unlisted fields are dropped', async (t) => {
  offerOn(t, '$5/month');
  const pb = require('./engine/personalbackup');
  const pk = require('./engine/personalbackupkey');
  const was = { switchOn: pb.switchOn, setUpKey: pb.setUpKey, saved: pk.confirmRecoveryCodeSaved };
  t.after(() => { pb.switchOn = was.switchOn; pb.setUpKey = was.setUpKey; pk.confirmRecoveryCodeSaved = was.saved; });
  const made = { ok: true, code: 'K7QD-3MXA-9VPE-H2NW-4TBR-6YC8-JF', org: 'org_x', member: 'm_x', epoch: 1, secretKey: 'never', path: '/never' };
  let gotOn = null; let gotSaved = null;
  pb.switchOn = async (ticket, accepted) => { gotOn = { ticket, accepted }; return made; };
  pb.setUpKey = async () => made;
  pk.confirmRecoveryCodeSaved = async (who) => { gotSaved = who; return { ok: true, deleted: 1, extra: 'never', org: 'not saved\'s field' }; };
  for (const k of ['on', 'key']) {
    const r = await call('/api/personal-backup/' + k, { body: { ticket: 't1', accepted: true }, headers: SCREEN });
    assert.deepEqual(r.json, { ok: true, recoveryCode: made.code, org: 'org_x', member: 'm_x' }, k + ': ' + JSON.stringify(r.json));
  }
  assert.deepEqual(gotOn, { ticket: 't1', accepted: true });
  const s = await call('/api/personal-backup/saved', { body: { org: 'org_x', member: 'm_x' }, headers: SCREEN });
  assert.deepEqual(s.json, { ok: true, deleted: 1 });
  assert.deepEqual(gotSaved, { org: 'org_x', member: 'm_x' });
});

test('#7404: restore and off pass only their own fields; restore goes through the engine binding check', async (t) => {
  offerOn(t, '$5/month');
  const pb = require('./engine/personalbackup');
  const was = { restore: pb.restore, switchOff: pb.switchOff };
  t.after(() => { pb.restore = was.restore; pb.switchOff = was.switchOff; });
  let gotCode = null;
  pb.restore = async (code) => { gotCode = code; return { ok: true, epochs: [1, 2], org: 'never', recoveryCode: 'never' }; };
  pb.switchOff = async () => ({ ok: false, pending: true, because: 'stopped here', epochs: 'never' });
  const r = await call('/api/personal-backup/restore', { body: { code: 'k7qd 3mxa' }, headers: SCREEN });
  assert.deepEqual(r.json, { ok: true, epochs: [1, 2] }, JSON.stringify(r.json));
  assert.equal(gotCode, 'k7qd 3mxa', 'the typed code reaches the engine as typed (it normalises)');
  const o = await call('/api/personal-backup/off', { body: {}, headers: SCREEN });
  assert.deepEqual(o.json, { ok: false, pending: true, because: 'stopped here' });
});
