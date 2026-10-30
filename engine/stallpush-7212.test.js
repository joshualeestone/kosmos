'use strict';
require('../test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * kosmos#7212 (#7615 item 1, Josh's 0.7.75 report: an agent unreachable for ten days, and nobody told): a stall the
 * board says is also pushed to the person's phone as needs-you, as a crash loop or a stuck terminal is.
 *
 *   node --test engine/stallpush-7212.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ds = require('./deliverystreak');

const MIN = 60 * 1000;
const T0 = Date.parse('2026-10-30T12:00:00Z');
const refused = { state: 'could_not', because: 'x' };

test.beforeEach(() => ds.resetForTests());

test('a stall said once is one needs-you event, named by its session and since; again only after a day', () => {
  for (let i = 0; i < 3; i += 1) ds.note('s-ada', refused, T0 + i * MIN);
  ds.note('s-ada', refused, T0 + 31 * MIN);
  const said = new Map();
  const card = { sessionName: 's-ada', name: 'Ada' };
  const first = ds.stallsToSay(['s-ada'], said, { now: T0 + 32 * MIN });
  assert.equal(first.length, 1, 'CONTROL: the stall is said');
  assert.deepEqual(ds.stallEvent(card, first[0]),
    { kind: 'needs_you', id: 'stall:s-ada:' + new Date(T0).toISOString(), agent: 'Ada', session: 's-ada', project: null });
  assert.equal(ds.stallsToSay(['s-ada'], said, { now: T0 + 40 * MIN }).length, 0, 'said (and so pushed) again the next minute');
  ds.note('s-ada', refused, T0 + 24 * 60 * MIN);
  assert.equal(ds.stallsToSay(['s-ada'], said, { now: T0 + 24 * 60 * MIN + 33 * MIN }).length, 1, 'not said again a day later');
});

test('a run of usage-limit holds the card already shows is not a stall, so nothing is pushed', () => {
  const limit = { state: 'could_not', held: true, heldBy: 'limit' };
  for (let i = 0; i < 4; i += 1) ds.note('s-bo', limit, T0 + i * 10 * MIN);
  assert.deepEqual(ds.stallsToSay(['s-bo'], new Map(), { now: T0 + 35 * MIN, limitShownOf: () => true }), []);
  assert.equal(ds.stallsToSay(['s-bo'], new Map(), { now: T0 + 35 * MIN, limitShownOf: () => false }).length, 1, 'CONTROL: unshown, it is one');
});

test('a stuck Windows turn is told once per step, with a turn: id; without tell, turnsToSay is unchanged', () => {
  const st = { since: '2026-10-30T10:00:00.000Z', count: 2, lastWhy: 'turn', step: 'running "x"' };
  const card = { sessionName: 's-cy', name: 'Cy', deliveryStall: st };
  const told = [];
  const said = new Map();
  const lines = ds.turnsToSay([card], said, (c, s) => told.push(ds.stallEvent(c, s)));
  assert.equal(lines.length, 1);
  assert.deepEqual(told, [{ kind: 'needs_you', id: 'turn:s-cy:2026-10-30T10:00:00.000Z', agent: 'Cy', session: 's-cy', project: null }]);
  ds.turnsToSay([card], said, (c, s) => told.push(ds.stallEvent(c, s)));
  assert.equal(told.length, 1, 'the same stuck step was told twice');
  assert.equal(ds.turnsToSay([{ ...card, sessionName: 's-dee' }], new Map()).length, 1, 'CONTROL: no tell, still says the line');
  assert.equal(ds.turnsToSay([{ ...card, sessionName: 's-eve' }], new Map(), () => { throw new Error('x'); }).length, 1, 'a tell that throws lost the line');
});

test('stallEvent names nothing it cannot name', () => {
  assert.equal(ds.stallEvent(null, { since: 'x' }), null);
  assert.equal(ds.stallEvent({ sessionName: '' }, { since: 'x' }), null);
  assert.equal(ds.stallEvent({ sessionName: 's' }, {}), null);
  assert.equal(ds.stallEvent({ sessionName: 's' }, { since: 'x' }).agent, 's', 'no name: the session');
});

test('the board pushes each stall it says (server.js sayStalls)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const at = src.indexOf('const sayStalls = () => {');
  assert.ok(at > 0, 'CONTROL: sayStalls is found');
  const body = src.slice(at, src.indexOf('} catch { /* said next minute */ }', at));
  assert.match(body, /const tellStall = \(card, st\) => \{ const ev = ds\.stallEvent\(card, st\); if \(ev\) phonenotify\.happened\(ev\); \};/);
  assert.match(body, /ds\.turnsToSay\(r, turnSaid, tellStall\)/, 'a stuck turn is not pushed');
  assert.match(body, /process\.stdout\.write\(ds\.stallLine\(st\)\);\n\s+try \{ tellStall\(byName\.get\(st\.name\), st\); \}/, 'a stall is not pushed where it is said');
});
