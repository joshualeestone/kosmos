'use strict';

/**
 * kosmos#7448 (after #7446: a demo board signed in to a real account pushed its made-up agents to that person's phone):
 * a computer marked never to send phone notices (the file `no-phone-notices` in its state dir, or
 * KOSMOS_NO_PHONE_NOTICES=1) sends nothing, never turns the switch on by itself, refuses a press with the reason, and
 * says so in Settings' status. Each case has a CONTROL: the same board unmarked sends.
 *
 *   node --test engine.phonenotify-nopush-7448.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-7448pn-'));
const state = path.join(dir, 'remote');
fs.mkdirSync(state, { recursive: true });
for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) fs.writeFileSync(path.join(state, f), 'x');
fs.writeFileSync(path.join(state, 'phone-notify.json'),
  JSON.stringify({ on: true, notifyId: '11111111-2222-4333-8444-555555555555', token: 'knt1_nopushtest0123456789' }));
process.env.AGENT_WORKFORCE_DATA = path.join(dir, 'data');
process.env.AGENT_WORKFORCE_TUNNEL_STATE = state;
process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR = 'http://127.0.0.1:9';   // never dialled: a sender is injected
delete process.env.KOSMOS_NO_PHONE_NOTICES;

const remote = require('./engine/remote');
fs.mkdirSync(path.dirname(remote.FILE), { recursive: true });
fs.writeFileSync(remote.FILE, JSON.stringify({ on: true }));   // Kosmos+ switched on here (#6488)
const pn = require('./engine/phonenotify');
// #7448: the default-on run now also starts a phone-notices report. No test here may reach a real coordinator, so the
// signed call is a quick refusal unless a test puts its own in.
const quickRefusal = async () => ({ ok: false, notSent: true, because: 'no coordinator in this test' });
remote.macRequest = quickRefusal;
pn.setAvailableForTests(true);
const sent = [];
pn.setSender((url, headers, body) => { sent.push(body); });

const mark = path.join(path.dirname(remote.FILE), 'no-phone-notices');   // beside remote.json, outside the state dir
const event = (n) => ({ kind: 'needs_you', session: 'demo' + n, agent: 'Demo ' + n });

test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

test('CONTROL: an unmarked, connected board sends a needs_you', () => {
  pn.resetCooldownForTests();
  const before = sent.length;
  pn.happened(event(1));
  assert.equal(sent.length, before + 1);
  assert.equal(pn.noPush(), false);
});

test('the no-phone-notices file stops every send, and Settings says why', async () => {
  fs.writeFileSync(mark, '');
  try {
    pn.resetCooldownForTests();
    const before = sent.length;
    for (let i = 2; i < 10; i++) pn.happened(event(i));   // the 8 of #7446
    assert.equal(sent.length, before, 'nothing is sent while marked');
    const s = pn.status();
    assert.equal(s.noPush, true);
    assert.equal(s.on, false, 'shown off whatever the older file holds');
    assert.match(s.because, /never sends phone notices/);
    const r = await pn.turnOn();
    assert.equal(r.ok, false);
    assert.match(r.because, /never sends phone notices/);
    assert.equal(await pn.ensureDefaultOn(), null, 'the switch never turns itself on');
  } finally { fs.rmSync(mark, { force: true }); }
  pn.resetCooldownForTests();
  const after = sent.length;
  pn.happened(event(11));
  assert.equal(sent.length, after + 1, 'CONTROL: with the mark gone it sends again');
});

test('KOSMOS_NO_PHONE_NOTICES=1 (a check run) stops every send too', () => {
  process.env.KOSMOS_NO_PHONE_NOTICES = '1';
  try {
    pn.resetCooldownForTests();
    const before = sent.length;
    pn.happened(event(12));
    assert.equal(sent.length, before);
    assert.equal(pn.status().noPush, true);
  } finally { delete process.env.KOSMOS_NO_PHONE_NOTICES; }
  assert.equal(pn.noPush(), false, 'CONTROL: unset, it is not marked');
});

test('review 1: the mark survives Forget computer (the state dir emptied), which is what re-arms a default turn-on', async () => {
  fs.writeFileSync(mark, '');
  try {
    remote.clearStateDir([]);   // what Forget computer does to the state dir
    assert.equal(fs.existsSync(path.join(state, 'phone-notify.json')), false, 'premise: the state dir really was emptied');
    assert.equal(pn.noPush(), true, 'still marked after Forget');
    assert.equal(await pn.ensureDefaultOn(), null);
  } finally { fs.rmSync(mark, { force: true }); }
});

test('review 1: a mark that cannot be looked at counts as marked (never send)', () => {
  // A path through a file where a folder should be: lstat fails with ENOTDIR, not ENOENT.
  const blocker = path.join(dir, 'not-a-dir');
  fs.writeFileSync(blocker, '');
  const real = remote.FILE;
  try {
    Object.defineProperty(remote, 'FILE', { value: path.join(blocker, 'remote.json'), configurable: true, writable: true });
    assert.equal(pn.noPush(), true);
  } finally { Object.defineProperty(remote, 'FILE', { value: real, configurable: true, writable: true }); }
  assert.equal(pn.noPush(), false, 'CONTROL: the real place, unmarked');
});

// #7448 with #7458 (Ice Cream Kitty's coordinator half): the board reports whether it sends, per computer id.
test('the board reports send to the coordinator once per change and computer, retries a failure, and never reads a 404 as off', async () => {
  await pn.whenNoticesIdle();
  const realReq = remote.macRequest, realId = remote.macIdHere;
  const calls = [];
  let answer = { ok: true, data: { ok: true, send: true } };
  let id = 'mac-one';
  remote.macRequest = async (method, route, body) => { calls.push({ method, route, body }); return answer; };
  remote.macIdHere = () => id;
  pn.resetNoticesReportedForTests();
  // The Forget test above emptied the state dir: signed in again for this one (premise checked below).
  for (const f of ['mac_id', 'mac_key', 'address', 'tls.crt', 'tls.key']) fs.writeFileSync(path.join(state, f), 'x');
  assert.equal(remote.enrolled(), true, 'premise: signed in');
  try {
    assert.deepEqual(await pn.reportPhoneNotices(), { ok: true, send: true });
    assert.deepEqual(calls.at(-1), { method: 'POST', route: '/v1/mac/phone-notices', body: { send: true } });
    assert.equal(await pn.reportPhoneNotices(), null, 'nothing changed: nothing sent');
    assert.equal(calls.length, 1);

    fs.writeFileSync(mark, '');
    // The shapes macRequest really returns: a tunnel without the route refuses it locally (Kitty m837), a coordinator
    // without it refuses (the 404), an old catch-all answers without the echo, or echoes the wrong value. Each is a
    // failure to retry on the schedule, never a confirmation.
    for (const refused of [{ ok: false, notSent: true, because: 'the tunnel does not sign that route' }, { ok: false, because: '404 not found' },
                           { ok: true, data: { error: 'not found' } }, { ok: true, data: { ok: true, send: true } }]) {
      answer = refused;
      assert.deepEqual(await pn.reportPhoneNotices(), { ok: false }, JSON.stringify(refused));
      assert.deepEqual(calls.at(-1).body, { send: false });
    }
    answer = { ok: true, data: { ok: true, send: false } };
    assert.deepEqual(await pn.reportPhoneNotices(), { ok: true, send: false }, 'retried on the next tick');
    assert.equal(calls.length, 6, 'each refusal was tried once, then the confirmation');

    id = 'mac-two';   // Forget plus a new sign-in
    answer = { ok: true, data: { ok: true, send: false } };
    assert.deepEqual(await pn.reportPhoneNotices(), { ok: true, send: false }, 'a new computer id is told again');
    assert.equal(calls.length, 7);
  } finally {
    fs.rmSync(mark, { force: true });
    remote.macRequest = realReq; remote.macIdHere = realId;
  }
});

test('nothing is reported while Kosmos+ is switched off here', async () => {
  const realReq = remote.macRequest;
  let called = false;
  remote.macRequest = async () => { called = true; return { ok: true }; };
  pn.resetNoticesReportedForTests();
  fs.writeFileSync(remote.FILE, JSON.stringify({ on: false }));
  try {
    assert.equal(await pn.reportPhoneNotices(), null);
    assert.equal(called, false);
  } finally {
    fs.writeFileSync(remote.FILE, JSON.stringify({ on: true }));
    remote.macRequest = realReq;
  }
});

test('review 1: the default-on run starts the report and does not wait for it', async () => {
  await pn.whenNoticesIdle();
  const realReq = remote.macRequest;
  let started = false, release;
  remote.macRequest = (method, route, body) => {
    if (route === pn.PHONE_NOTICES_ROUTE) { started = true; return new Promise((r) => { release = r; }); }
    return quickRefusal(method, route, body);
  };
  pn.resetNoticesReportedForTests();
  try {
    const t0 = Date.now();
    await pn.ensureDefaultOn();
    assert.equal(started, true, 'the report was started by the default-on run');
    assert.ok(Date.now() - t0 < 1000, 'the default-on run did not wait for a hung report');
    assert.equal(await pn.reportPhoneNotices(), null, 'one report at a time');
  } finally {
    if (release) release({ ok: false });
    remote.macRequest = realReq;
    await new Promise((r) => setImmediate(r));
  }
});
