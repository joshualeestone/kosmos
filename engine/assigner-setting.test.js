'use strict';
/* #2619 / #3595: the Assigner automation setting - ON by default since the idle-assign behaviour
 * landed (engine/assigner.js); corrupt reads off. Sandboxed data root before the require, as
 * heartbeat-setting.test.js. */
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

test('default: ON (#3595, the behaviour is wired), clean read', () => {
  const s = asg.read();
  assert.equal(s.on, true, 'a never-configured install should have the Assigner on');
  assert.equal(s.ok, true);
});

test('setOn(true) enables it; read reflects it', () => {
  assert.deepEqual(asg.setOn(true), { ok: true });
  assert.equal(asg.read().on, true);
  assert.deepEqual(asg.setOn(false), { ok: true });
  assert.equal(asg.read().on, false);
});

test('setOn rejects a non-boolean and does not write', () => {
  assert.deepEqual(asg.setOn(false), { ok: true });
  assert.equal(asg.setOn('on').ok, false);
  assert.equal(asg.read().on, false, 'a refused value overwrote the stored off');
  fs.rmSync(asg.FILE, { force: true });
  assert.equal(asg.setOn('off').ok, false);
  assert.equal(fs.existsSync(asg.FILE), false, 'a refused value wrote a file');
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

test('a stored file missing the flag reads on, as an absent one does; only explicit false is off', () => {
  fs.writeFileSync(asg.FILE, JSON.stringify({ note: 'hand-edited' }) + '\n');
  assert.equal(asg.read().on, true);
  fs.writeFileSync(asg.FILE, JSON.stringify({ on: false }) + '\n');
  assert.equal(asg.read().on, false);
});
