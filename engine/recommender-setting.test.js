'use strict';
/* #2619: the Recommender automation setting - off by default (behaviour not yet
 * wired), the three guards ON by default (the safe/restrictive direction).
 * Sandboxed data root before the require, exactly as heartbeat-setting.test.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-recommender-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const rec = require('./recommender-setting');

test.beforeEach(() => { fs.mkdirSync(nodePath.dirname(rec.FILE), { recursive: true }); });
test.afterEach(() => { fs.rmSync(rec.FILE, { force: true }); });

test('defaults: OFF (behaviour pending) with all three guards ON, clean read', () => {
  const s = rec.read();
  assert.equal(s.on, false, 'an unwired automation must not read as on');
  assert.deepEqual(s.guards, { money: true, public: true, delete: true });
  assert.equal(s.ok, true, 'an absent store is a clean never-configured read');
});

test('the guard set is exactly money/public/delete (the irreversible-consequence carve-outs)', () => {
  assert.deepEqual([...rec.GUARD_KEYS], ['money', 'public', 'delete']);
});

test('setOn(true) enables it; read() reflects it; guards untouched', () => {
  assert.deepEqual(rec.setOn(true), { ok: true });
  const s = rec.read();
  assert.equal(s.on, true);
  assert.deepEqual(s.guards, { money: true, public: true, delete: true }, 'toggling on does not change guards');
});

test('setOn rejects a non-boolean and does not write', () => {
  const r = rec.setOn('yes');
  assert.equal(r.ok, false);
  assert.equal(rec.read().on, false, 'nothing persisted on a bad value');
});

test('setGuard toggles one guard, leaves the others, and is independent of on', () => {
  assert.deepEqual(rec.setGuard('money', false), { ok: true });
  const s = rec.read();
  assert.equal(s.guards.money, false, 'the money guard is now off');
  assert.equal(s.guards.public, true);
  assert.equal(s.guards.delete, true);
  assert.equal(s.on, false, 'setting a guard does not enable the automation');
});

test('a guard can be pre-set before the automation is ever enabled', () => {
  rec.setGuard('delete', false);
  rec.setOn(true);
  const s = rec.read();
  assert.equal(s.on, true);
  assert.equal(s.guards.delete, false, 'the pre-set guard survives enabling');
});

test('setGuard rejects an unknown guard name (a typo must not silently no-op)', () => {
  const r = rec.setGuard('spend', false);
  assert.equal(r.ok, false);
  assert.match(r.because, /unknown guard/);
});

test('setGuard rejects a non-boolean value', () => {
  assert.equal(rec.setGuard('money', 1).ok, false);
});

test('CONTROL (safe direction): a corrupt/partial config falls to all-guards-ON, never off', () => {
  // The dangerous answer would be a corrupt config that DROPS a guard to off,
  // letting the Recommender act where it must not. Prove it falls the safe way.
  fs.writeFileSync(rec.FILE, '{ this is not json', 'utf8');
  let s = rec.read();
  assert.equal(s.on, false);
  assert.deepEqual(s.guards, { money: true, public: true, delete: true }, 'corrupt -> all guards on');
  assert.equal(s.ok, false, 'and it reports the read was not clean');
  // A PARTIAL guards object (only money set, and to false) fills the missing guards ON.
  fs.writeFileSync(rec.FILE, JSON.stringify({ on: true, guards: { money: false } }) + '\n');
  s = rec.read();
  assert.equal(s.guards.money, false, 'the explicitly-set guard is honoured');
  assert.equal(s.guards.public, true, 'a missing guard fills ON, not off');
  assert.equal(s.guards.delete, true);
});

test('CONTROL: an array config is rejected to safe defaults, not read as an object', () => {
  fs.writeFileSync(rec.FILE, JSON.stringify([1, 2, 3]) + '\n');
  const s = rec.read();
  assert.equal(s.on, false);
  assert.deepEqual(s.guards, { money: true, public: true, delete: true });
  assert.equal(s.ok, false);
});

test('a guard stored non-boolean (hand-edit) falls to ON', () => {
  fs.writeFileSync(rec.FILE, JSON.stringify({ on: true, guards: { money: 'off', public: true, delete: true } }) + '\n');
  assert.equal(rec.read().guards.money, true, 'a non-boolean guard is not trusted; falls to the safe ON');
});
