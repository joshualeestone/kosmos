'use strict';
require('../test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * kosmos#7212 item 2: a stall the board log said ends silently. When a line lands for an agent whose stall was said,
 * the board log says once that it ended (delivery-stall-ended:), how long it lasted and how many tries did not land,
 * and whether the phone was told of the stall. A streak that ended without being said, or one cleared because the card
 * says itself (reset) or the agent left the board (sweep), says nothing.
 *
 *   node --test engine/stallended-7212.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-stallended-7212-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');

const test = require('node:test');
const assert = require('node:assert/strict');
const ds = require('./deliverystreak');

const T0 = Date.parse('2026-11-02T10:00:00Z');
const MIN = 60 * 1000;
const FAIL = { state: 'could_not', inputHeld: true };
const PLACED = { state: 'placed' };

/* A streak of `n` failures a minute apart from T0, said by stallsToSay at `sayAt`. */
function saidStall(name, said, { n = 4, sayAt = T0 + 40 * MIN } = {}) {
  for (let i = 0; i < n; i += 1) ds.note(name, FAIL, T0 + i * MIN);
  const out = ds.stallsToSay([name], said, { now: sayAt });
  assert.equal(out.length, 1, 'the stall is said first (the precondition every case below rests on)');
}

test('a said stall that a landed line ends is said to have ended, once', () => {
  ds.resetForTests();
  const said = new Map();
  saidStall('a1', said);
  ds.note('a1', PLACED, T0 + 95 * MIN);
  const ends = ds.endsToSay(said);
  assert.equal(ends.length, 1);
  const e = ends[0];
  assert.equal(e.name, 'a1');
  assert.equal(e.since, new Date(T0).toISOString());
  assert.equal(e.endedAt, new Date(T0 + 95 * MIN).toISOString());
  assert.equal(e.count, 4);
  assert.equal(e.ms, 95 * MIN);
  assert.equal(e.pushed, false);
  assert.equal(ds.endedLine(e), 'delivery-stall-ended: a message reached a1 at 2026-11-02T11:35:00.000Z, ending the stall'
    + ' said since 2026-11-02T10:00:00.000Z (95 minutes, 4 tries that did not land).\n');
  assert.equal(said.has('a1'), false, 'the said entry is spent');
  assert.deepEqual(ds.endsToSay(said), [], 'never said twice');
});

test('a streak that ended without being said says nothing', () => {
  ds.resetForTests();
  const said = new Map();
  for (let i = 0; i < 4; i += 1) ds.note('a2', FAIL, T0 + i * MIN);
  ds.note('a2', PLACED, T0 + 10 * MIN);
  assert.deepEqual(ds.endsToSay(said), []);
  /* Control: the same streak, said, does speak (so the empty answer above is the rule, not a dead function). */
  saidStall('a2b', said);
  ds.note('a2b', PLACED, T0 + 50 * MIN);
  assert.equal(ds.endsToSay(said).length, 1);
});

test('a stall cleared by reset did not recover and says nothing', () => {
  ds.resetForTests();
  const said = new Map();
  saidStall('r1', said);
  ds.reset('r1');
  ds.note('r1', PLACED, T0 + 60 * MIN);   // no streak any more, so a landed line ends nothing
  assert.deepEqual(ds.endsToSay(said), []);
});

test('an end for an agent that then left the board is forgotten by the sweep', () => {
  ds.resetForTests();
  const said = new Map();
  saidStall('s1', said);
  saidStall('s2', said);
  ds.note('s1', PLACED, T0 + 50 * MIN);
  ds.note('s2', PLACED, T0 + 50 * MIN);
  ds.sweep(['s2']);   // s1 left the board before the sweep asked
  const ends = ds.endsToSay(said);
  assert.deepEqual(ends.map((e) => e.name), ['s2'], 'CONTROL: s2, still on the board, is said; s1 is not');
});

test('a second short streak ending before the sweep does not replace the said one', () => {
  ds.resetForTests();
  const said = new Map();
  saidStall('q1', said);
  ds.note('q1', PLACED, T0 + 50 * MIN);
  ds.note('q1', { state: 'unconfirmed' }, T0 + 50 * MIN + 10000);
  ds.note('q1', PLACED, T0 + 50 * MIN + 20000);
  const ends = ds.endsToSay(said);
  assert.equal(ends.length, 1);
  assert.equal(ends[0].since, new Date(T0).toISOString());
  assert.equal(ends[0].count, 4);
});

test('the board asks for ends before stallsToSay forgets them, inside the sweep', () => {
  const src = require('node:fs').readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const at = src.indexOf('const sayStalls = () => {');
  assert.ok(at > 0, 'CONTROL: the sweep is found');
  const body = src.slice(at, src.indexOf('} catch { /* said next minute */ }', at));
  const settled = body.indexOf('for (const c of r) ds.settleFor(c);');
  const ends = body.indexOf('ds.endsToSay(stallSaid)');
  const says = body.indexOf('ds.stallsToSay(');
  assert.ok(settled > 0 && ends > settled && says > ends, 'endsToSay is not between settleFor and stallsToSay: ' + [settled, ends, says]);
});

test('an end the sweep reads after a new streak began still names the stall that was said', () => {
  ds.resetForTests();
  const said = new Map();
  saidStall('n1', said);
  ds.note('n1', PLACED, T0 + 50 * MIN);
  ds.note('n1', FAIL, T0 + 51 * MIN);   // a new streak, before the minute sweep asked
  const ends = ds.endsToSay(said);
  assert.equal(ends.length, 1);
  assert.equal(ends[0].since, new Date(T0).toISOString());
  assert.equal(ends[0].count, 4, 'the ended streak, not the new one');
});

test('pushed is true only for a stall push that went out during the streak', () => {
  ds.resetForTests();
  const file = path.join(SANDBOX, 'data', ds.PUSH_FILE);
  const said = new Map();
  saidStall('p1', said);
  const card = { sessionName: 'p1', name: 'p1', deliveryStall: ds.stallOf('p1', { now: T0 + 40 * MIN }) };
  assert.ok(card.deliveryStall);
  ds.tellStalls([card], { now: T0 + 40 * MIN, file, send: () => true });
  ds.note('p1', PLACED, T0 + 3 * 24 * 60 * MIN);
  const [e] = ds.endsToSay(said);
  assert.equal(e.pushed, true);
  assert.match(ds.endedLine(e), /\(3 days, 4 tries that did not land; the phone was told of the stall\)\.\n$/);
  /* Control: a push before this streak began is not this stall's push. */
  ds.resetForTests();
  const said2 = new Map();
  ds.tellStalls([{ sessionName: 'p3', name: 'p3', deliveryStall: { since: new Date(T0 - 60 * MIN).toISOString(), count: 3, lastWhy: 'input' } }],
    { now: T0 - 20 * MIN, file: null, send: () => true });
  saidStall('p3', said2);
  ds.note('p3', PLACED, T0 + 50 * MIN);
  assert.equal(ds.endsToSay(said2)[0].pushed, false);
});

test('spanWords reads minutes, then hours, then days', () => {
  assert.equal(ds.spanWords(1 * MIN), '1 minute');
  assert.equal(ds.spanWords(119 * MIN), '119 minutes');
  assert.equal(ds.spanWords(120 * MIN), '2 hours');
  assert.equal(ds.spanWords(47 * 60 * MIN), '47 hours');
  assert.equal(ds.spanWords(16 * 24 * 60 * MIN), '16 days');
});

test('an unread end of a streak never said does not hold back the end of a said stall', () => {
  ds.resetForTests();
  const said = new Map();
  for (let i = 0; i < 2; i += 1) ds.note('u1', FAIL, T0 - 10 * MIN + i * MIN);
  ds.note('u1', PLACED, T0 - 5 * MIN);   // a short streak, never said, and no sweep asked after it
  saidStall('u1', said);
  ds.note('u1', PLACED, T0 + 50 * MIN);
  const ends = ds.endsToSay(said);
  assert.equal(ends.length, 1, 'the said stall\'s end is said');
  assert.equal(ends[0].since, new Date(T0).toISOString());
});
