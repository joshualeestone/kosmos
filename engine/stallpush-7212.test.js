'use strict';
require('../test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * kosmos#7212 (#7615 item 1, Josh's 0.7.75 report: an agent unreachable for ten days, and nobody told): every card
 * carrying a stall is also pushed to the person's phone as needs-you, as a crash loop or a stuck terminal is, at most
 * once a day per agent, counted only when a push went out (deliverystreak.tellStalls).
 *
 *   node --test engine/stallpush-7212.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ds = require('./deliverystreak');

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const T0 = Date.parse('2026-10-30T12:00:00Z');
const SINCE = '2026-10-30T11:20:00.000Z';
const fileIn = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-stallpush-')), ds.PUSH_FILE);
const card = (sessionName, extra = {}) => ({ sessionName, name: sessionName.toUpperCase(), deliveryStall: { since: SINCE, count: 4, lastWhy: 'refused' }, ...extra });
const sender = (answer = true) => { const sent = []; return { sent, send: (ev) => { sent.push(ev); return typeof answer === 'function' ? answer(ev) : answer; } }; };

test.beforeEach(() => ds.resetForTests());

test('a card carrying a stall is one needs-you event, named by its day, since and session', () => {
  assert.deepEqual(ds.stallEvent(card('s-ada'), T0),
    { kind: 'needs_you', id: 'stall:0:' + SINCE + ':s-ada', agent: 'S-ADA', session: 's-ada', project: null, stall: true });
  assert.equal(ds.stallEvent(card('s-ada'), T0 + DAY).id, 'stall:1:' + SINCE + ':s-ada', 'a day later the id did not move on');
  const turn = card('s-cy', { deliveryStall: { since: SINCE, count: 2, lastWhy: 'turn', step: 'x' } });
  assert.match(ds.stallEvent(turn, T0).id, /^turn:0:/);
  assert.equal(ds.stallEvent({ sessionName: 's' }, T0), null, 'a card with no stall named one');
  assert.equal(ds.stallEvent(null, T0), null);
  assert.equal(ds.stallEvent({ sessionName: '', deliveryStall: { since: SINCE } }, T0), null);
  assert.equal(ds.stallEvent({ sessionName: 's', deliveryStall: { since: SINCE } }, T0).agent, 's', 'no name: the session');
});

test('told at most once a day per agent, across a restart and a stall that ends and starts again', () => {
  const file = fileIn();
  const a = sender();
  ds.tellStalls([card('s-ada'), card('s-bo')], { now: T0, file, send: a.send });
  assert.deepEqual(a.sent.map((e) => e.session), ['s-ada', 's-bo']);
  ds.tellStalls([card('s-ada', { deliveryStall: { since: '2026-10-30T12:40:00.000Z', count: 3, lastWhy: 'input' } })], { now: T0 + 70 * MIN, file, send: a.send });
  assert.equal(a.sent.length, 2, 'a stall that ended and started again was told again within the day');
  ds.resetForTests();   // a board restart: nothing in memory, only the file
  ds.tellStalls([card('s-ada')], { now: T0 + 2 * 60 * MIN, file, send: a.send });
  assert.equal(a.sent.length, 2, 'a board restart told the person again');
  ds.tellStalls([card('s-ada')], { now: T0 + DAY, file, send: a.send });
  assert.equal(a.sent.length, 3, 'a day later it was not told again');
});

test('review 2 W1: a push the phone side did not send is not counted, so it goes once it can', () => {
  const file = fileIn();
  const off = sender(false);
  ds.tellStalls([card('s-ada')], { now: T0, file, send: off.send });
  assert.equal(off.sent.length, 1, 'CONTROL: it was tried');
  const on = sender(true);
  ds.tellStalls([card('s-ada')], { now: T0 + 10 * MIN, file, send: on.send });
  assert.equal(on.sent.length, 1, 'a phone set up ten minutes later was not told until the next day');
  ds.tellStalls([card('s-ada')], { now: T0 + 11 * MIN, file, send: on.send });
  assert.equal(on.sent.length, 1, 'CONTROL: once sent, it is counted');
});

test('review 2 W2: a record that cannot be written still holds it to once a day while the board runs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-stallpush-'));
  fs.writeFileSync(path.join(dir, 'blocked'), 'not a folder');
  const file = path.join(dir, 'blocked', ds.PUSH_FILE);
  const a = sender();
  ds.tellStalls([card('s-ada')], { now: T0, file, send: a.send });
  assert.equal(a.sent.length, 1, 'an unwritable record silenced the push');
  ds.tellStalls([card('s-ada', { deliveryStall: { since: '2026-10-30T13:00:00.000Z', count: 3, lastWhy: 'refused' } })], { now: T0 + 60 * MIN, file, send: a.send });
  assert.equal(a.sent.length, 1, 'with an unwritable record a new stall pushed again within the day');
});

test('review 2: odd records and names do not break the gate', () => {
  const file = fileIn();
  fs.writeFileSync(file, '{ not json');
  const a = sender();
  ds.tellStalls([card('__proto__')], { now: T0, file, send: a.send });
  assert.equal(a.sent.length, 1, 'a corrupt record silenced the push');
  ds.resetForTests();
  ds.tellStalls([card('__proto__')], { now: T0 + MIN, file, send: a.send });
  assert.equal(a.sent.length, 1, 'a session named __proto__ was never gated');
  fs.writeFileSync(file, JSON.stringify({ 's-bo': T0 + 5 * DAY }));   // a clock that went back
  ds.tellStalls([card('s-bo')], { now: T0, file, send: a.send });
  assert.equal(a.sent.length, 2, 'an entry from the future silenced the agent');
  ds.tellStalls([card('s-cy')], { now: T0, file, send: () => { throw new Error('x'); } });
  ds.tellStalls([card('s-cy')], { now: T0, file, send: a.send });
  assert.equal(a.sent.length, 3, 'a send that threw counted as told');
});

test('the board tells every card carrying a stall, through phonenotify, each minute (server.js sayStalls)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const at = src.indexOf('const sayStalls = () => {');
  assert.ok(at > 0, 'CONTROL: sayStalls is found');
  const body = src.slice(at, src.indexOf('} catch { /* said next minute */ }', at));
  assert.match(body, /ds\.tellStalls\(shown\.map\(\(n\) => byName\.get\(n\)\), \{ file: STALL_PUSH_FILE, send: \(ev\) => phonenotify\.happened\(ev\) \}\);/);
  assert.match(src, /const STALL_PUSH_FILE = path\.join\(store\.ROOT, require\('\.\/engine\/deliverystreak'\)\.PUSH_FILE\);/);
});
