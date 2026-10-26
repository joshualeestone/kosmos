'use strict';
require('../test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * kosmos#7212 slice 1: a delivery held by an agent's input box is never silent and never called a usage limit.
 * Josh's Claude seat sat seven days with messages held behind its input box: the card read Idle, the stuck-input sweep
 * (#6717) left no line, and the board log said the held messages were given "after its usage reset". Three engine
 * pieces now say the true thing: the limit queue's delivered line names why it was held, the queue says once when
 * messages have waited half an hour behind an input box, and the sweep says once why it is still waiting after
 * half an hour.
 *
 *   node --test engine/heldwarn-7212.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-heldwarn-7212-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('./store');
const limitqueue = require('./limitqueue');
const stuckinput = require('./stuckinput');
const { assertSandboxedDataRoot } = require('../test-support/data-root-sandbox');

assertSandboxedDataRoot(SANDBOX, [store.ROOT, limitqueue.dir()]);

const MIN = 60 * 1000;

test('#7212: a message held by the input box is logged as such, never as a usage reset', () => {
  const input = limitqueue.deliveredLine({ name: 'dario', id: 'm1', state: 'placed', why: limitqueue.heldWhy({ input: true }) });
  assert.match(input, /once its input box was empty/);
  assert.doesNotMatch(input, /usage/, 'a message held by the input box was logged as a usage reset');
  assert.match(limitqueue.deliveredLine({ name: 'a', id: 'm', state: 'placed', why: limitqueue.heldWhy({ signin: true }) }), /signed in again/);
  // CONTROL: a message kept for a usage limit still says so.
  assert.match(limitqueue.deliveredLine({ name: 'a', id: 'm', state: 'placed', why: limitqueue.heldWhy({}) }), /after its usage reset/);
});

test('#7212: messages held behind an input box for half an hour are found; younger ones and limit holds are not', () => {
  const now = Date.parse('2026-10-26T12:00:00Z');
  const at = (m) => new Date(now - m * MIN).toISOString();
  assert.ok(limitqueue.add('heldold', { id: 'a', from: 'x', envelope: 'e', at: at(45), reset: at(45), input: true }));
  assert.ok(limitqueue.add('heldold', { id: 'b', from: 'x', envelope: 'e', at: at(5), reset: at(5), input: true }));
  assert.ok(limitqueue.add('heldnew', { id: 'c', from: 'x', envelope: 'e', at: at(10), reset: at(10), input: true }));
  assert.ok(limitqueue.add('limitonly', { id: 'd', from: 'x', envelope: 'e', at: at(300), reset: at(300) }));
  const found = limitqueue.heldBehindInput(now, limitqueue.HELD_INPUT_SAY_MS);
  assert.deepEqual(found, [{ name: 'heldold', since: at(45), count: 2 }],
    'only the agent whose OLDEST input-held message is half an hour old, counted whole');
});

test('#7212: the stuck-input sweep says once why it keeps waiting, after half an hour and not before', async () => {
  const lines = [];
  let since = new Date(Date.parse('2026-10-26T12:00:00Z') - 31 * MIN).toISOString();
  const now = Date.parse('2026-10-26T12:00:00Z');
  const card = () => ({ name: 'Dario', sessionName: 'dario', state: 'idle', runner: 'claude', unsentInput: { since } });
  const tick = stuckinput.makeTick({
    allowed: () => true,
    roster: () => [card()],
    recover: async () => ({ outcome: 'waiting', because: 'gate' }),
    stuckMs: 10 * MIN,
    log: (l) => lines.push(l),
    now: () => now,
  });
  await tick();
  await tick();
  assert.equal(lines.length, 1, 'said more than once, or not at all');
  assert.match(lines[0], /dario.*~31 min: not cleared yet, still waiting \(gate\)/);
  // A new text (a new since) younger than half an hour is not said: the sweep is still within its ordinary retries.
  since = new Date(now - 20 * MIN).toISOString();
  await tick();
  assert.equal(lines.length, 1, 'a text stuck 20 minutes was reported as a long wait');
});

test('#7212: flush reports why each message it typed was held, so the board log line comes from the real path', async () => {
  const chat = require('./chat');
  const now = new Date().toISOString();
  assert.ok(limitqueue.add('flushpat', { id: 'f1', from: 'x', envelope: 'e1', at: now, reset: now, input: true }));
  assert.ok(limitqueue.add('flushpat', { id: 'f2', from: 'x', envelope: 'e2', at: now, reset: now }));
  const roster = [{ name: 'flushpat', sessionName: 'flushpat', state: 'idle' }];
  const done = await limitqueue.flush(roster, {
    deliver: async () => ({ state: chat.DELIVERY.PLACED }), isReleased: () => true,
    resolveCard: (r, k) => r.find((c) => c.sessionName === k) || null, DELIVERY: chat.DELIVERY,
  });
  assert.deepEqual(done.map((d) => [d.id, d.why]), [['f1', 'input'], ['f2', 'limit']]);
  assert.match(limitqueue.deliveredLine(done[0]), /once its input box was empty/);
  assert.match(limitqueue.deliveredLine(done[1]), /after its usage reset/);
});

test('#7212 review: a held stretch is said once while it drains, and a new stretch is said again', () => {
  const now = Date.parse('2026-10-26T12:00:00Z');
  const at = (m) => new Date(now - m * MIN).toISOString();
  for (const [id, m] of [['s1', 50], ['s2', 45], ['s3', 40]]) {
    assert.ok(limitqueue.add('drainer', { id, from: 'x', envelope: 'e', at: at(m), reset: at(m), input: true }));
  }
  const said = new Set();
  const say = () => limitqueue.heldInputToSay(now, limitqueue.HELD_INPUT_SAY_MS, said).filter((h) => h.name === 'drainer');
  assert.equal(say().length, 1, 'CONTROL: a stretch held half an hour is said');
  assert.equal(say().length, 0, 'said again the next minute');
  // The oldest is delivered (or dropped at a day): the next oldest is also past half an hour. Still the same stretch.
  assert.ok(limitqueue.remove('drainer', 's1'));
  assert.equal(say().length, 0, 'delivering the oldest message said the stretch again');
  assert.ok(limitqueue.remove('drainer', 's2'));
  assert.equal(say().length, 0, 'dropping another said the stretch again');
  // The stretch ends when nothing is held behind the box; a later hold is a new stretch and is said.
  assert.ok(limitqueue.remove('drainer', 's3'));
  assert.equal(say().length, 0);
  assert.ok(!said.has('drainer'), 'an ended stretch was remembered');
  assert.ok(limitqueue.add('drainer', { id: 's4', from: 'x', envelope: 'e', at: at(35), reset: at(35), input: true }));
  assert.equal(say().length, 1, 'a new stretch was never said');
});

test('#7212 review: the stuck-input sweep says nothing when the box has emptied', async () => {
  const lines = [];
  const now = Date.parse('2026-10-26T12:00:00Z');
  const since = new Date(now - 40 * MIN).toISOString();
  const tick = stuckinput.makeTick({
    allowed: () => true,
    roster: () => [{ name: 'Ema', sessionName: 'ema', state: 'idle', runner: 'claude', unsentInput: { since } }],
    recover: async () => ({ outcome: 'waiting', because: 'empty' }),
    stuckMs: 10 * MIN,
    log: (l) => lines.push(l),
    now: () => now,
  });
  await tick();
  assert.deepEqual(lines, [], 'an emptied box was reported as text still unsent');
});

test('#7212 review 2: a queue file that cannot be read for a minute does not end the stretch', () => {
  const now = Date.parse('2026-10-26T12:00:00Z');
  const at = new Date(now - 40 * MIN).toISOString();
  assert.ok(limitqueue.add('glitchy', { id: 'g1', from: 'x', envelope: 'e', at, reset: at, input: true }));
  const said = new Set();
  const say = () => limitqueue.heldInputToSay(now, limitqueue.HELD_INPUT_SAY_MS, said).filter((h) => h.name === 'glitchy');
  assert.equal(say().length, 1);
  const file = limitqueue.fileFor('glitchy');
  const good = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, good.slice(0, 5));   // a write caught half done
  assert.equal(say().length, 0);
  assert.ok(said.has('glitchy'), 'an unreadable minute ended the stretch');
  fs.writeFileSync(file, good);
  assert.equal(say().length, 0, 'the stretch was said again after a read glitch');
});

test('#7212 review 2: the board knows a flush is still typing, so the box is not read under it', async () => {
  const chat = require('./chat');
  const now = new Date().toISOString();
  assert.ok(limitqueue.add('slowpat', { id: 'w1', from: 'x', envelope: 'e', at: now, reset: now }));
  let finish;
  const typed = new Promise((r) => { finish = r; });
  assert.equal(limitqueue.isFlushing(), false, 'CONTROL: nothing is typing yet');
  const run = limitqueue.flush([{ name: 'slowpat', sessionName: 'slowpat', state: 'idle' }], {
    deliver: async () => { await typed; return { state: chat.DELIVERY.PLACED }; }, isReleased: () => true,
    resolveCard: (r, k) => r.find((c) => c.sessionName === k) || null, DELIVERY: chat.DELIVERY,
  });
  assert.equal(limitqueue.isFlushing(), true, 'a run typing a message was not seen');
  assert.deepEqual(await limitqueue.flush([], {}), [], 'CONTROL: a second run skips while one is in flight');
  assert.equal(limitqueue.isFlushing(), true);
  finish();
  await run;
  assert.equal(limitqueue.isFlushing(), false, 'a finished run still reads as typing');
});

test('#7212 review 2: a thrown error is logged by its kind, never its message text', async () => {
  const lines = [];
  const now = Date.parse('2026-10-26T12:00:00Z');
  const since = new Date(now - 40 * MIN).toISOString();
  const tick = stuckinput.makeTick({
    allowed: () => true,
    roster: () => [{ name: 'Ira', sessionName: 'ira', state: 'idle', runner: 'claude', unsentInput: { since } }],
    recover: async () => { throw new Error('secret words from the box'); },
    stuckMs: 10 * MIN,
    log: (l) => lines.push(l),
    now: () => now,
  });
  await tick();
  assert.equal(lines.length, 1);
  assert.match(lines[0], /still waiting \(failed\)/);
  assert.doesNotMatch(lines[0], /secret/);
});
