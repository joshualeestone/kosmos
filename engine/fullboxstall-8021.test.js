'use strict';
require('../test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * kosmos#8021: a box that stays full, with messages kept behind it, is a delivery stall. Those messages never reached a
 * delivery verdict, so the streak never grew: a seat stayed full for 63 minutes on a real board with one sentence on its
 * card and nothing else. Drives the real sweep, the real queue, its real flush and the real streak, with the wiring
 * server.js uses (the last test pins the two together).
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
const ISO = new Date(T0).toISOString();
const DELIVERY = { PLACED: 'placed', UNCONFIRMED: 'unconfirmed' };

const wiring = {
  heldBehind: (session) => limitqueue.heldForInput(session),
  noteHeld: (session, now) => ds.note(session, { state: 'could_not', inputHeld: true, swept: true }, now),
  takeBack: (session) => ds.takeBack(session),
};
function sweep(card, clock, recover = async () => ({ outcome: 'left', because: 'Enter did not send it' })) {
  return stuckinput.makeTick({
    allowed: () => true, roster: () => [card], recover, stuckMs: 10 * MIN, log: () => {}, now: () => clock.at, ...wiring,
  });
}
const cardFor = (s) => ({ sessionName: s, name: s, state: 'idle', runner: 'claude', unsentInput: { since: ISO } });
const keep = (s, id) => limitqueue.addOrWhy(s, { id, from: 'x', envelope: 'hello', at: ISO, reset: ISO, key: id, input: true });
const said = (s, at, map = new Map()) => ds.stallsToSay([s], map, { now: at });
async function run(tick, clock, from, to) {
  for (clock.at = from; clock.at <= to; clock.at += MIN) await tick();
  clock.at = to;
}
const flushWith = (card, clock, state) => limitqueue.flush([card], {
  deliver: async (n) => { const v = { state }; ds.note(n, v, clock.at); return v; },
  isReleased: () => true, resolveCard: () => card, DELIVERY, now: clock.at,
});

test('kosmos#8021: a full box with a message kept behind it is said as a stall, naming the box and claiming no tries', async () => {
  const s = 's-held'; const clock = { at: T0 + 11 * MIN };
  assert.equal(keep(s, 'm1'), '', 'CONTROL: the queue took the message');
  const tick = sweep(cardFor(s), clock);
  await run(tick, clock, T0 + 11 * MIN, T0 + 30 * MIN);
  assert.deepEqual(said(s, clock.at), [], 'not said before the stall threshold');
  await run(tick, clock, T0 + 31 * MIN, T0 + 42 * MIN);
  const out = said(s, clock.at);
  assert.equal(out.length, 1, 'said once it has stood for the threshold');
  const line = ds.stallLine(out[0]);
  assert.match(line, /delivery-stall: no message has been seen to reach s-held/);
  assert.match(line, /input box holds text/, 'the reason is the box');
  assert.doesNotMatch(line, /tries/, 'nothing was tried');
  assert.equal(ds.failCount(s), 0, 'a sender counting failures is not told of tries that never were');
});

test('kosmos#8021: a full box with nothing kept behind it says nothing: no message was refused', async () => {
  const s = 's-empty'; const clock = { at: T0 };
  await run(sweep(cardFor(s), clock), clock, T0 + 11 * MIN, T0 + 45 * MIN);
  assert.deepEqual(said(s, clock.at), []);
  assert.equal(ds.sweptCount(s), 0);
});

test('kosmos#8021: a message kept for another reason does not count', async () => {
  const s = 's-limit'; const clock = { at: T0 };
  assert.equal(limitqueue.addOrWhy(s, { id: 'm2', from: 'x', envelope: 'hello', at: ISO, reset: ISO, key: 'm2' }), '');
  await run(sweep(cardFor(s), clock), clock, T0 + 11 * MIN, T0 + 45 * MIN);
  assert.equal(ds.sweptCount(s), 0);
});

test('kosmos#8021: a box the sweep gave up on still counts', async () => {
  const s = 's-gaveup'; const clock = { at: T0 };
  keep(s, 'm3');
  await run(sweep(cardFor(s), clock, async () => ({ outcome: 'drafted-not-cleared', because: 'keys rebound' })), clock, T0 + 11 * MIN, T0 + 15 * MIN);
  assert.ok(ds.sweptCount(s) >= 5, 'each pass counted, past the give-up: ' + ds.sweptCount(s));
});

test('kosmos#8021: through the real flush, a kept message that lands ends a said stall, and says so', async () => {
  const s = 's-ends'; const clock = { at: T0 }; const card = cardFor(s);
  keep(s, 'm4');
  const tick = sweep(card, clock);
  await run(tick, clock, T0 + 11 * MIN, T0 + 45 * MIN);
  const map = new Map();
  assert.equal(said(s, clock.at, map).length, 1, 'CONTROL: it was said');
  await flushWith(card, clock, 'placed');
  assert.equal(limitqueue.list(s).length, 0, 'CONTROL: the flush took it out of the queue');
  const ends = ds.endsToSay(map, { now: clock.at + MIN });
  assert.equal(ends.length, 1, 'said to have ended');
  const line = ds.endedLine(ends[0]);
  assert.match(line, /delivery-stall-ended: .*s-ends/);
  assert.doesNotMatch(line, /tries/, 'none were tried');
});

test('kosmos#8021: through the real flush, a line typed and not seen to land keeps the stall: it is a real failure', async () => {
  const s = 's-unconf'; const clock = { at: T0 }; const card = cardFor(s);
  keep(s, 'm5');
  const tick = sweep(card, clock);
  await run(tick, clock, T0 + 11 * MIN, T0 + 45 * MIN);
  await flushWith(card, clock, 'unconfirmed');
  assert.equal(limitqueue.list(s).length, 0, 'CONTROL: the flush took it out of the queue');
  clock.at += MIN; await tick();
  assert.equal(ds.failCount(s), 1, 'the typed line is still counted');
  assert.equal(ds.sweptCount(s), 0, 'the sweep took back its own passes');
});

test('kosmos#8021: taking back removes only the sweep\'s part: a stall of real failures stays, with its own start', async () => {
  const s = 's-real'; const clock = { at: T0 };
  const real = T0 - 3 * 24 * 60 * MIN;
  for (let i = 0; i < 51; i += 1) ds.note(s, { state: 'unconfirmed' }, real + i * MIN);
  keep(s, 'm6');
  const tick = sweep(cardFor(s), clock);
  await run(tick, clock, T0 + 11 * MIN, T0 + 15 * MIN);
  assert.ok(ds.sweptCount(s) >= 3, 'CONTROL: the sweep had counted');
  limitqueue.remove(s, 'm6');   // what the flush does to an entry past its age
  clock.at += MIN; await tick();
  assert.equal(ds.sweptCount(s), 0);
  assert.equal(ds.failCount(s), 51, 'all 51 real failures stay');
  const out = said(s, clock.at);
  assert.equal(out.length, 1, 'still a stall');
  assert.equal(out[0].since, new Date(real).toISOString(), 'dated from its first real failure');
});

test('kosmos#8021: a streak the sweep began goes with its messages, so its start cannot date a later failure', async () => {
  const s = 's-dropped'; const clock = { at: T0 };
  keep(s, 'm7');
  const tick = sweep(cardFor(s), clock);
  await run(tick, clock, T0 + 11 * MIN, T0 + 15 * MIN);
  assert.ok(ds.sweptCount(s) >= 3, 'CONTROL: the sweep had counted');
  limitqueue.remove(s, 'm7');
  clock.at += MIN; await tick();
  assert.equal(ds.sweptCount(s), 0);
  ds.note(s, { state: 'could_not', because: 'x' }, clock.at + 60 * MIN);
  assert.deepEqual(said(s, clock.at + 60 * MIN), [], 'one later refusal is not a stall dated from the old start');
});

test('kosmos#8021: a real failure inside a sweep-begun streak dates it from that failure when the sweep takes its part back', async () => {
  const s = 's-mixed'; const clock = { at: T0 };
  keep(s, 'm8');
  const tick = sweep(cardFor(s), clock);
  await run(tick, clock, T0 + 11 * MIN, T0 + 15 * MIN);
  const failed = T0 + 15 * MIN + 1000;
  ds.note(s, { state: 'unconfirmed' }, failed);
  for (let i = 0; i < 3; i += 1) ds.note(s, { state: 'unconfirmed' }, failed + 40 * MIN + i);
  limitqueue.remove(s, 'm8');
  clock.at += MIN; await tick();
  const out = said(s, failed + 41 * MIN);
  assert.equal(out.length, 1);
  assert.equal(out[0].since, new Date(failed).toISOString());
});

test('kosmos#8021: a sweep pass does not rename what real failures began', async () => {
  const s = 's-why'; const clock = { at: T0 };
  ds.note(s, { state: 'could_not', held: true, heldBy: 'limit', heldFor: 'signin' }, T0);
  keep(s, 'm9');
  ds.note(s, { state: 'could_not', held: true, heldBy: 'limit', heldFor: 'signin' }, T0 + MIN);
  ds.note(s, { state: 'could_not', held: true, heldBy: 'limit', heldFor: 'signin' }, T0 + 2 * MIN);
  const tick = sweep(cardFor(s), clock);
  await run(tick, clock, T0 + 11 * MIN, T0 + 45 * MIN);
  const out = said(s, clock.at);
  assert.equal(out.length, 1);
  assert.doesNotMatch(out[0].words, /input box/, 'its own reason stands: ' + out[0].words);
});

test('kosmos#8021: a queue file that cannot be read this minute takes nothing back', async () => {
  const s = 's-corrupt'; const clock = { at: T0 };
  keep(s, 'm10');
  const dir = path.join(require('./store').ROOT, 'limitqueue');
  const file = fs.readdirSync(dir).map((f) => path.join(dir, f)).find((f) => fs.readFileSync(f, 'utf8').includes('m10'));
  assert.ok(file, 'CONTROL: found the queue file');
  const tick = sweep(cardFor(s), clock);
  await run(tick, clock, T0 + 11 * MIN, T0 + 15 * MIN);
  const n = ds.sweptCount(s);
  assert.ok(n >= 3, 'CONTROL: the sweep had counted');
  const good = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, '{ not json');
  clock.at += MIN; await tick();
  assert.ok(ds.sweptCount(s) >= n, 'not taken back');
  fs.writeFileSync(file, good);
  assert.equal(limitqueue.list(s).length, 1, 'CONTROL: the message was still kept');
});

test('kosmos#8021: server.js wires the sweep with the same words as this test', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const at = text.indexOf("require('./engine/stuckinput').makeTick(");
  assert.ok(at > 0, 'the sweep is not wired');
  const block = text.slice(at, text.indexOf('stuckInputSweep.unref()', at));
  assert.match(block, /heldBehind: \(session\) => require\('\.\/engine\/limitqueue'\)\.heldForInput\(session\)/);
  assert.match(block, /noteHeld: \(session, now\) => require\('\.\/engine\/deliverystreak'\)\.note\(session, \{ state: 'could_not', inputHeld: true, swept: true \}, now\)/);
  assert.match(block, /takeBack: \(session\) => require\('\.\/engine\/deliverystreak'\)\.takeBack\(session\)/);
});
