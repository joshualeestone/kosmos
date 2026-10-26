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
