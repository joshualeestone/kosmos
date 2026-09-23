'use strict';
/**
 * engine/prompternudge.js -- #3508: the Prompter's local in-app nudge store.
 * The store is the current pending set, replaced each tick; local 0600; carries
 * who + from/to, never a sentence; never throws.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-nudge-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const nudge = require('./prompternudge');

function fresh() { try { fs.unlinkSync(nudge.FILE); } catch { /* none */ } }

test('read on an absent file returns an empty set', () => {
  fresh();
  assert.deepEqual(nudge.read(), { at: null, nudges: [] });
});

test('write then read round-trips the toAsk shape (who + from/to)', () => {
  fresh();
  const r = nudge.write([{ session: 'leo-discord', from: 'working', to: 'stopped' }]);
  assert.equal(r.ok, true);
  const got = nudge.read();
  assert.equal(got.nudges.length, 1);
  assert.deepEqual(got.nudges[0], { session: 'leo-discord', from: 'working', to: 'stopped' });
  assert.match(got.at, /^\d{4}-\d\d-\d\dT/);
});

test('write REPLACES the pending set, so a resolved stall clears', () => {
  fresh();
  nudge.write([{ session: 'a', to: 'stopped' }, { session: 'b', to: 'idle' }]);
  nudge.write([{ session: 'b', to: 'idle' }]); // a resolved
  assert.deepEqual(nudge.read().nudges.map((n) => n.session), ['b']);
});

test('the file is mode 0600 (local, never leaves the Mac)', () => {
  fresh();
  nudge.write([{ session: 'a', to: 'stopped' }]);
  assert.equal(fs.statSync(nudge.FILE).mode & 0o777, 0o600);
});

test('a nudge with no session is dropped (cannot render or act on it)', () => {
  fresh();
  nudge.write([{ from: 'working', to: 'stopped' }, { session: '', to: 'idle' }, { session: 'ok', to: 'stopped' }]);
  assert.deepEqual(nudge.read().nudges.map((n) => n.session), ['ok']);
});

test('write coerces bad input, never throws, and carries no free-text field', () => {
  fresh();
  assert.doesNotThrow(() => nudge.write(null));
  assert.doesNotThrow(() => nudge.write('nope'));
  assert.doesNotThrow(() => nudge.write([null, 42, { session: 'x', to: 'stopped', words: 'SECRET' }]));
  const got = nudge.read();
  assert.deepEqual(got.nudges.map((n) => n.session), ['x']);
  assert.equal(JSON.stringify(got).includes('SECRET'), false, 'a stray field leaked into the store');
});

test('read on a corrupt or wrong-shape file returns empty and does not throw', () => {
  fresh();
  fs.writeFileSync(nudge.FILE, 'not json');
  assert.deepEqual(nudge.read(), { at: null, nudges: [] });
  fs.writeFileSync(nudge.FILE, JSON.stringify({ v: 1, nudges: 'x' }));
  assert.deepEqual(nudge.read(), { at: null, nudges: [] });
});
