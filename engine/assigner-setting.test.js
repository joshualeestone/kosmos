'use strict';
/* #2619: the Assigner automation setting - off by default (behaviour not yet
 * wired). Sandboxed data root before the require, as heartbeat-setting.test.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-assigner-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const asg = require('./assigner-setting');

test.beforeEach(() => { fs.mkdirSync(nodePath.dirname(asg.FILE), { recursive: true }); });
test.afterEach(() => { fs.rmSync(asg.FILE, { force: true }); });

test('default: OFF (behaviour pending), clean read', () => {
  const s = asg.read();
  assert.equal(s.on, false, 'an unwired automation must not read as on');
  assert.equal(s.ok, true);
});

test('setOn(true) enables it; read reflects it', () => {
  assert.deepEqual(asg.setOn(true), { ok: true });
  assert.equal(asg.read().on, true);
  assert.deepEqual(asg.setOn(false), { ok: true });
  assert.equal(asg.read().on, false);
});

test('setOn rejects a non-boolean and does not write', () => {
  assert.equal(asg.setOn('on').ok, false);
  assert.equal(asg.read().on, false);
});

test('CONTROL: a corrupt config falls to OFF and reports not-clean', () => {
  fs.writeFileSync(asg.FILE, '{ not json', 'utf8');
  const s = asg.read();
  assert.equal(s.on, false);
  assert.equal(s.ok, false);
});

test('CONTROL: an array config is rejected to off, not read as an object', () => {
  fs.writeFileSync(asg.FILE, JSON.stringify([{ on: true }]) + '\n');
  const s = asg.read();
  assert.equal(s.on, false);
  assert.equal(s.ok, false);
});

test('a stored file missing the flag reads off (only explicit true enables)', () => {
  fs.writeFileSync(asg.FILE, JSON.stringify({ note: 'hand-edited' }) + '\n');
  assert.equal(asg.read().on, false);
});
