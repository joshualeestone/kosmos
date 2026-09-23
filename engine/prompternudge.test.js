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
const store = require('./store');

function fresh() { try { fs.unlinkSync(nudge.FILE); } catch { /* none */ } }

test('the store lives under the ONE data-root derivation (store.ROOT), NOT bare $DATA', () => {
  // #1848/#1856: routing through the raw AGENT_WORKFORCE_DATA switch skips the `Kosmos`
  // app leaf that store.ROOT appends, so the file lands a stray sibling of a named
  // world's dir. This assertion reds if the implementation ever reverts to that switch.
  assert.equal(nudge.FILE, nodePath.join(store.ROOT, 'prompter-nudges.json'));
  assert.match(nudge.FILE, /[/\\]Kosmos[/\\]prompter-nudges\.json$/,
    'the nudge store must sit inside the Kosmos world leaf, not beside it');
});

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

test('read caps over-long fields the same way write does (single-sourced shape)', () => {
  fresh();
  // A hand-edited or older file with uncapped fields must not reach the API uncapped.
  fs.writeFileSync(nudge.FILE, JSON.stringify({
    v: 1, at: '2026-01-01T00:00:00Z',
    nudges: [{ session: 'x'.repeat(500), from: 'y'.repeat(500), to: 'z'.repeat(500) }],
  }));
  const got = nudge.read().nudges[0];
  assert.equal(got.session.length, 120);
  assert.equal(got.from.length, 40);
  assert.equal(got.to.length, 40);
});

test('read on a corrupt or wrong-shape file returns empty and does not throw', () => {
  fresh();
  fs.writeFileSync(nudge.FILE, 'not json');
  assert.deepEqual(nudge.read(), { at: null, nudges: [] });
  fs.writeFileSync(nudge.FILE, JSON.stringify({ v: 1, nudges: 'x' }));
  assert.deepEqual(nudge.read(), { at: null, nudges: [] });
});
