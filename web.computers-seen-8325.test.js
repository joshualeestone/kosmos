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

/* The real worldswComputersSeen, starting from a remembered value, with the page around it stubbed. */
function seenFrom() {
  const calls = { tip: 0, drop: 0, wrote: [] };
  const src = `
    let COMPUTERS_OPENABLE = true, COMPUTERS_CONFIRMED = false, THIS_COMPUTER_NAME = 'a', COMPUTERS_SIGNED_OUT = false;
    let COMPUTERS_RETRY_T = null, COMPUTERS_STALE_WHILE_HIDDEN = false, COMPUTERS_EXPECT_UNTIL = 0, COMPUTERS_FAILS = 0;
    const MULTI_KOSMOS = false;
    const worldswTipOnce = () => { calls.tip += 1; }, worldswTipDrop = () => { calls.drop += 1; };
    const computersSeenWrite = (open) => { calls.wrote.push(open); }, worldswOneKosmos = () => {}, computersFetch = () => Promise.resolve();
    const setTimeout = () => 0, clearTimeout = () => {};
    const window = {}, document = { hidden: false, getElementById: () => null };
    ${page.liftAll(SCRIPT, ['worldswComputersSeen'])}
    return { seen: worldswComputersSeen, open: () => COMPUTERS_OPENABLE };`;
  return { ...new Function('calls', src)(calls), calls };
}
const two = [{ name: 'a', this: true }, { name: 'b' }];

test('the first good answer gives the tip its turn; the next does not', () => {
  const c = seenFrom();
  c.seen(two, true, false);
  assert.equal(c.calls.tip, 1);
  c.seen(two, true, false);
  assert.equal(c.calls.tip, 1);
  assert.deepEqual(c.calls.wrote, [true, true]);
});

test('a good answer with one computer drops the control and forgets it', () => {
  const c = seenFrom();
  c.seen([{ name: 'a', this: true }], true, false);
  assert.equal(c.open(), false);
  assert.deepEqual(c.calls.wrote, [false]);
});

test('a failed read keeps a remembered control, however many fail, and never writes', () => {
  const c = seenFrom();
  for (let i = 0; i < 12; i += 1) { c.seen([], false, false); assert.equal(c.open(), true, 'read ' + (i + 1)); }
  assert.deepEqual(c.calls.wrote, []);
});

test('a confirmed control is kept through failures too', () => {
  const c = seenFrom();
  c.seen(two, true, false);
  for (let i = 0; i < 6; i += 1) c.seen([], false, false);
  assert.equal(c.open(), true);
});

test('the control starts from what was remembered, and not with several Kosmoses on', () => {
  assert.match(SCRIPT, /const COMPUTERS_SEEN = MULTI_KOSMOS \? null : computersSeenRead\(\);/);
  assert.match(SCRIPT, /let COMPUTERS_OPENABLE = Boolean\(COMPUTERS_SEEN\);/);
  assert.match(SCRIPT, /let THIS_COMPUTER_NAME = COMPUTERS_SEEN \? COMPUTERS_SEEN\.name : '';/);
});
