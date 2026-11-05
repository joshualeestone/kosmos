'use strict';
require('../test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * kosmos#8021: a box that stays full, with messages kept behind it, is a delivery stall. Those messages never reached a
 * delivery verdict, so the streak never grew: a seat stayed full for 63 minutes on a real board with one sentence on its
 * card and nothing else. Drives the real sweep, the real queue and the real streak, with the wiring server.js uses.
 *
 *   node --test engine/fullboxstall-8021.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-8021-')));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
fs.mkdirSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const stuckinput = require('./stuckinput');
const limitqueue = require('./limitqueue');
const ds = require('./deliverystreak');

const MIN = 60 * 1000;
const T0 = Date.parse('2026-11-05T07:00:00.000Z');

function src() { return fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8'); }

/* The wiring, as server.js writes it: the test below pins that the two are the same words. */
const wiring = {
  heldBehind: (card) => limitqueue.list(card.sessionName).some((e) => e && e.input === true),
  noteHeld: (card, now) => ds.note(card.sessionName, { state: 'could_not', inputHeld: true }, now),
  clearHeld: (session) => ds.reset(session),
};

function sweep(card, clock, recover = async () => ({ outcome: 'left', because: 'Enter did not send it' })) {
  return stuckinput.makeTick({
    allowed: () => true, roster: () => [card], recover, stuckMs: 10 * MIN, log: () => {}, now: () => clock.at, ...wiring,
  });
}
const cardFor = (s) => ({ sessionName: s, name: s, state: 'idle', runner: 'claude', unsentInput: { since: new Date(T0).toISOString() } });
const keep = (s, id) => limitqueue.addOrWhy(s, { id, from: 'x', envelope: 'hello', at: new Date(T0).toISOString(), reset: new Date(T0).toISOString(), key: id, input: true });
const said = (s, at, map = new Map()) => ds.stallsToSay([s], map, { now: at });

async function run(tick, clock, from, to) {
  for (clock.at = from; clock.at <= to; clock.at += MIN) await tick();
}

test('kosmos#8021: a full box with a message kept behind it is said as a stall, with the box as its reason', async () => {
  const s = 's-held'; const clock = { at: T0 + 11 * MIN };
  assert.equal(keep(s, 'm1'), '', 'CONTROL: the queue took the message');
  const tick = sweep(cardFor(s), clock);
  await run(tick, clock, T0 + 11 * MIN, T0 + 20 * MIN);
  assert.deepEqual(said(s, clock.at), [], 'not said before the stall threshold');
  await run(tick, clock, T0 + 21 * MIN, T0 + 42 * MIN);
  const out = said(s, clock.at);
  assert.equal(out.length, 1, 'said once it has stood for the threshold');
  assert.match(ds.stallLine(out[0]), /^.*delivery-stall: no message has been seen to reach s-held/);
  assert.match(ds.stallLine(out[0]), /input box holds text/, 'the reason is the box');
});

test('kosmos#8021: a full box with nothing kept behind it says nothing: no message was refused', async () => {
  const s = 's-empty'; const clock = { at: T0 };
  await run(sweep(cardFor(s), clock), clock, T0 + 11 * MIN, T0 + 45 * MIN);
  assert.deepEqual(said(s, clock.at), []);
  assert.equal(ds.failCount(s), 0);
});

test('kosmos#8021: a message kept for another reason does not count', async () => {
  const s = 's-limit'; const clock = { at: T0 };
  assert.equal(limitqueue.addOrWhy(s, { id: 'm2', from: 'x', envelope: 'hello', at: new Date(T0).toISOString(), reset: new Date(T0).toISOString(), key: 'm2' }), '');
  await run(sweep(cardFor(s), clock), clock, T0 + 11 * MIN, T0 + 45 * MIN);
  assert.equal(ds.failCount(s), 0);
});

test('kosmos#8021: a box the sweep gave up on still counts', async () => {
  const s = 's-gaveup'; const clock = { at: T0 };
  keep(s, 'm3');
  await run(sweep(cardFor(s), clock, async () => ({ outcome: 'drafted-not-cleared', because: 'keys rebound' })), clock, T0 + 11 * MIN, T0 + 15 * MIN);
  assert.ok(ds.failCount(s) >= 5, 'each pass counted, past the give-up: ' + ds.failCount(s));
});

test('kosmos#8021: when the kept message lands, the stall that was said is said to have ended', async () => {
  const s = 's-ends'; const clock = { at: T0 };
  keep(s, 'm4');
  await run(sweep(cardFor(s), clock), clock, T0 + 11 * MIN, T0 + 45 * MIN);
  const map = new Map();
  assert.equal(said(s, clock.at, map).length, 1, 'CONTROL: it was said');
  ds.note(s, { state: 'placed' }, clock.at);
  const ends = ds.endsToSay(map, { now: clock.at + MIN });
  assert.equal(ends.length, 1, 'said to have ended');
  assert.match(ds.endedLine(ends[0]), /delivery-stall-ended: .*s-ends/);
});

test('kosmos#8021: kept messages that age out take the streak with them, so its start cannot date a later failure', async () => {
  const s = 's-dropped'; const clock = { at: T0 };
  keep(s, 'm5');
  const tick = sweep(cardFor(s), clock);
  await run(tick, clock, T0 + 11 * MIN, T0 + 15 * MIN);
  assert.ok(ds.failCount(s) >= 3, 'CONTROL: the sweep had counted');
  limitqueue.remove(s, 'm5');   // what the flush does to an entry past its age
  clock.at += MIN; await tick();
  assert.equal(ds.failCount(s), 0, 'the streak went with them');
  ds.note(s, { state: 'could_not', because: 'x' }, clock.at + 60 * MIN);
  assert.deepEqual(said(s, clock.at + 60 * MIN), [], 'one later refusal is not a stall dated from the old start');
});

test('kosmos#8021: a streak with messages still kept, its box now clear, is left to end when one lands', async () => {
  const s = 's-kept'; const clock = { at: T0 };
  keep(s, 'm6');
  const card = cardFor(s);
  const tick = sweep(card, clock);
  await run(tick, clock, T0 + 11 * MIN, T0 + 15 * MIN);
  const n = ds.failCount(s);
  assert.ok(n >= 3, 'CONTROL: the sweep had counted');
  delete card.unsentInput;   // the box reads empty; the message waits on the flush
  clock.at += MIN; await tick();
  assert.equal(ds.failCount(s), n, 'not cleared, and not counted further');
});

test('kosmos#8021: server.js wires the sweep with the same words as this test', () => {
  const text = src();
  const at = text.indexOf("require('./engine/stuckinput').makeTick(");
  assert.ok(at > 0, 'the sweep is not wired');
  const block = text.slice(at, text.indexOf('stuckInputSweep.unref()', at));
  assert.match(block, /heldBehind: \(card\) => require\('\.\/engine\/limitqueue'\)\.list\(card\.sessionName\)\.some\(\(e\) => e && e\.input === true\)/);
  assert.match(block, /noteHeld: \(card, now\) => require\('\.\/engine\/deliverystreak'\)\.note\(card\.sessionName, \{ state: 'could_not', inputHeld: true \}, now\)/);
  assert.match(block, /clearHeld: \(session\) => require\('\.\/engine\/deliverystreak'\)\.reset\(session\)/);
});
