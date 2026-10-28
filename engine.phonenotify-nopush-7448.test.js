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
    assert.match(s.because, /never to send phone notices/);
    const r = await pn.turnOn();
    assert.equal(r.ok, false);
    assert.match(r.because, /never to send phone notices/);
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
