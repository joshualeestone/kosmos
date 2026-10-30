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
  assert.deepEqual(a.sent.map((e) => [e.session, e.agent]), [['s-ada', 'S-ADA and 1 more']], 'two stalls in one sweep were not one push');
  ds.tellStalls([card('s-bo')], { now: T0 + MIN, file, send: a.send });
  assert.equal(a.sent.length, 1, 'an agent the combined push covered was told again');
  ds.tellStalls([card('s-ada', { deliveryStall: { since: '2026-10-30T12:40:00.000Z', count: 3, lastWhy: 'input' } })], { now: T0 + 70 * MIN, file, send: a.send });
  assert.equal(a.sent.length, 1, 'a stall that ended and started again was told again within the day');
  ds.resetForTests();   // a board restart: nothing in memory, only the file
  ds.tellStalls([card('s-ada')], { now: T0 + 2 * 60 * MIN, file, send: a.send });
  assert.equal(a.sent.length, 1, 'a board restart told the person again');
  ds.tellStalls([card('s-ada')], { now: T0 + DAY, file, send: a.send });
  assert.equal(a.sent.length, 2, 'a day later it was not told again');
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
  ds.tellStalls([card('s-cy')], { now: T0 + 20 * MIN, file, send: () => { throw new Error('x'); } });
  ds.tellStalls([card('s-cy')], { now: T0 + 20 * MIN, file, send: a.send });
  assert.equal(a.sent.length, 3, 'a send that threw counted as told');
});

test('the board tells every card carrying a stall, through phonenotify, each minute (server.js sayStalls)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const at = src.indexOf('const sayStalls = () => {');
  assert.ok(at > 0, 'CONTROL: sayStalls is found');
  const body = src.slice(at, src.indexOf('} catch { /* said next minute */ }', at));
  assert.match(body, /ds\.tellStalls\(r, \{ file: STALL_PUSH_FILE, send: \(ev\) => phonenotify\.happened\(ev\) \}\);/, 'the board does not hand its whole roster to tellStalls');
  assert.match(src, /const STALL_PUSH_FILE = path\.join\(store\.ROOT, require\('\.\/engine\/deliverystreak'\)\.PUSH_FILE\);/);
});

test('review 3: the record is read once per sweep, not once per stalled card, while nothing can be sent', () => {
  const file = fileIn();
  fs.writeFileSync(file, '{}');
  const real = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function (p, ...rest) { if (p === file) reads += 1; return real.call(this, p, ...rest); };
  try {
    ds.tellStalls([card('s-a'), card('s-b'), card('s-c')], { now: T0, file, send: () => false });
    assert.equal(reads, 1, 'three stalled cards read the record ' + reads + ' times in one sweep');
    ds.tellStalls([card('s-a')], { now: T0 + MIN, file, send: () => false });
    assert.equal(reads, 2, 'CONTROL: the next sweep reads it again');
  } finally { fs.readFileSync = real; }
});

test('review 3: the board tells the stalls after it has settled the cards, inside the sweep', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const at = src.indexOf('const sayStalls = () => {');
  const body = src.slice(at, src.indexOf('} catch { /* said next minute */ }', at));
  const settled = body.indexOf('for (const c of r) ds.settleFor(c);');
  const shown = body.indexOf('const shown = names.filter(');
  const told = body.indexOf('ds.tellStalls(');
  assert.ok(settled > 0 && shown > settled && told > shown, 'tellStalls is not after settleFor and shown: ' + [settled, shown, told]);
  assert.equal(body.slice(0, told).includes('return;\n'), true, 'CONTROL: the early return for an empty roster is above it');
  assert.equal((body.slice(told).match(/return/g) || []).length, 0, 'something can return before the stalls are told');
});

test('review 4: one cause stalling many agents is one push, and a healthy card on the roster is never told', () => {
  const file = fileIn();
  const a = sender();
  const healthy = { sessionName: 's-ok', name: 'OK', deliveryStall: null };
  ds.tellStalls([healthy, card('s-a'), card('s-b'), card('s-c'), card('s-a')], { now: T0, file, send: a.send });
  assert.equal(a.sent.length, 1, 'three stalls in one minute buzzed ' + a.sent.length + ' times');
  assert.equal(a.sent[0].agent, 'S-A and 2 more', 'the one push does not say how many');
  assert.equal(a.sent[0].session, 's-a');
  ds.tellStalls([healthy], { now: T0 + MIN, file, send: a.send });
  assert.equal(a.sent.length, 1, 'a card with no stall was told');
  ds.tellStalls([card('s-d')], { now: T0 + 2 * MIN, file, send: a.send });
  assert.equal(a.sent.length, 1, 'review 5: a stall a cause started two minutes later buzzed again at once');
  ds.tellStalls([card('s-d'), card('s-e')], { now: T0 + 16 * MIN, file, send: a.send });
  assert.equal(a.sent.length, 2, 'CONTROL: past the gap, the waiting stalls are told');
  assert.equal(a.sent[1].agent, 'S-D and 1 more', 'the push after the gap did not name the ones that waited');
  ds.tellStalls([card('s-f')], { now: T0 + 32 * MIN, file, send: a.send });
  assert.equal(a.sent[2].agent, 'S-F', 'a single stall said "and 0 more"');
});

test('review 6 W1: a push Kosmos+ did not take is taken back, so its agents are told at the next push', () => {
  const file = fileIn();
  let result = null;
  const sent = [];
  const send = (ev) => { sent.push(ev); result = ev.onResult; return true; };
  ds.tellStalls([card('s-a'), card('s-b')], { now: T0, file, send });
  assert.equal(sent.length, 1);
  assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(file, 'utf8')), 's-b'), true, 'CONTROL: counted as told once sent');
  result(false);   // the network said no
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8'))), [], 'a push that never arrived stayed counted on disk');
  ds.tellStalls([card('s-a'), card('s-b')], { now: T0 + MIN, file, send });
  assert.equal(sent.length, 2, 'a push that never arrived was not tried again (or waited out the 15 minutes)');
  sent[1].onResult(true);
  ds.tellStalls([card('s-a')], { now: T0 + 20 * MIN, file, send });
  assert.equal(sent.length, 2, 'CONTROL: one that arrived stays counted');
});

test('review 6 W2: a long name keeps its count whole within the 80-byte agent field', () => {
  const a = sender();
  const long = card('s-long', { name: 'Ä'.repeat(60) });   // 120 bytes
  ds.tellStalls([long, ...Array.from({ length: 11 }, (_, i) => card('s-' + i))], { now: T0, file: fileIn(), send: a.send });
  const agent = a.sent[0].agent;
  assert.ok(Buffer.byteLength(agent) <= 80, 'the agent field is ' + Buffer.byteLength(agent) + ' bytes');
  assert.match(agent, / and 11 more$/, 'the count was cut: ' + agent);
  assert.doesNotMatch(agent, /�/, 'a character was cut in half');
});

test('review 6 W3: a card in a crash loop is told by the crash-loop push, not again here', () => {
  const a = sender();
  ds.tellStalls([card('s-loop', { crashLoop: { looping: true } })], { now: T0, file: fileIn(), send: a.send });
  assert.equal(a.sent.length, 0, 'a crash-looping card was pushed twice');
  ds.tellStalls([card('s-ok', { crashLoop: { looping: false } })], { now: T0, file: fileIn(), send: a.send });
  assert.equal(a.sent.length, 1, 'CONTROL: a card not looping is told');
});

test('review 6: phonenotify takes a push back when Kosmos+ does not answer 2xx, and passes onResult through', () => {
  const src = fs.readFileSync(path.join(__dirname, 'phonenotify.js'), 'utf8');
  assert.match(src, /tell\(res\.statusCode >= 200 && res\.statusCode < 300\);/);
  assert.match(src, /req\.on\('error', \(err\) => \{\n[^\n]*\n    tell\(false\);/, 'a network error is not reported');
  assert.match(src, /body, typeof event\.onResult === 'function' \? event\.onResult : null\);/);
  assert.match(src, /if \(last !== undefined && last <= now && now - last < route\.ms\) return false;/, 'a cooldown stamp from the future still holds');
});
