'use strict';
/* kosmos#8325: the computer switcher is painted from the last good answer until the first real one lands. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const page = require('./test-support/page');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);

function make(store, broken) {
  const localStorage = {
    getItem: (k) => { if (broken) throw new Error('blocked'); return k in store ? store[k] : null; },
    setItem: (k, v) => { if (broken) throw new Error('blocked'); store[k] = v; },
    removeItem: (k) => { if (broken) throw new Error('blocked'); delete store[k]; },
  };
  const src = page.liftConst(SCRIPT, 'COMPUTERS_SEEN_KEY') + '\n' + page.liftAll(SCRIPT, ['computersSeenRead', 'computersSeenWrite'])
    + '\nreturn { computersSeenRead, computersSeenWrite };';
  return new Function('localStorage', src)(localStorage);
}

test('nothing remembered reads as nothing', () => {
  assert.equal(make({}).computersSeenRead(), null);
});

test('a good answer with two computers is remembered, with this computer\'s name only', () => {
  const store = {};
  const c = make(store);
  c.computersSeenWrite(true, 'kitchen-mac');
  assert.deepEqual(c.computersSeenRead(), { name: 'kitchen-mac' });
  assert.deepEqual(Object.keys(JSON.parse(store['kosmos.computersSeen'])).sort(), ['name', 'openable']);
});

test('a good answer with one computer forgets it', () => {
  const store = {};
  const c = make(store);
  c.computersSeenWrite(true, 'a');
  c.computersSeenWrite(false, 'a');
  assert.equal(c.computersSeenRead(), null);
  assert.equal('kosmos.computersSeen' in store, false);
});

test('a broken value or blocked storage reads as nothing and never throws', () => {
  assert.equal(make({ 'kosmos.computersSeen': '{not json' }).computersSeenRead(), null);
  assert.equal(make({ 'kosmos.computersSeen': '{"openable":"yes"}' }).computersSeenRead(), null);
  const blocked = make({}, true);
  assert.equal(blocked.computersSeenRead(), null);
  assert.doesNotThrow(() => blocked.computersSeenWrite(true, 'x'));
});

test('only a good answer writes it, a failed read does not', () => {
  const m = SCRIPT.match(/function worldswComputersSeen\(rows, good, signedOut\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'worldswComputersSeen not found');
  const goodArm = m[0].slice(m[0].indexOf('if (good) {'), m[0].indexOf('} else if (COMPUTERS_OPENABLE)'));
  assert.match(goodArm, /computersSeenWrite\(COMPUTERS_OPENABLE, THIS_COMPUTER_NAME\)/);
  assert.equal(m[0].split('computersSeenWrite').length, 2);
});

test('a remembered value leaves the first-time tip its turn, and gives up after repeated failures', () => {
  const m = SCRIPT.match(/function worldswComputersSeen\(rows, good, signedOut\) \{[\s\S]*?\n\}/);
  assert.match(m[0], /const was = COMPUTERS_CONFIRMED && COMPUTERS_OPENABLE;/);
  assert.match(m[0], /COMPUTERS_OPENABLE && !COMPUTERS_CONFIRMED && COMPUTERS_FAILS >= COMPUTERS_SEEN_GIVE_UP_FAILS\) \{\n\s+COMPUTERS_OPENABLE = false;/);
});

test('the control starts from what was remembered, and not with several Kosmoses on', () => {
  assert.match(SCRIPT, /const COMPUTERS_SEEN = MULTI_KOSMOS \? null : computersSeenRead\(\);/);
  assert.match(SCRIPT, /let COMPUTERS_OPENABLE = Boolean\(COMPUTERS_SEEN\);/);
  assert.match(SCRIPT, /let THIS_COMPUTER_NAME = COMPUTERS_SEEN \? COMPUTERS_SEEN\.name : '';/);
});
