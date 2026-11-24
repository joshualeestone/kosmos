'use strict';

/**
 * kosmos#9010: before a move restarts an agent, it is asked to write its handoff, the move waits (a time limit) for the
 * file, restarts it either way, and points the fresh session at the handoff. Driven with its dependencies stated, as
 * accountmove-6173.test.js is: a fake restart, a fake handoff (ask, freshness, pickup) the test controls.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const accountmove = require('./accountmove');

const REFUSED = 'refused-by-create';
const RESTARTED = 'restarted-by-remove';
const tick = () => new Promise((r) => setImmediate(r));
const until = async (f, ms = 3000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 5)); } };

function deps({ handoff } = {}) {
  const events = [], held = new Set();
  return {
    events, held,
    hold: (names) => names.forEach((n) => held.add(n)),
    release: (name) => held.delete(name),
    setAccount: () => ({ outcome: 'changed', account: { email: 'spare@example.com' } }),
    REFUSED,
    moveRefusal: () => null,
    forget: () => {},
    restartAsync: async (name) => { events.push(['restart', name]); return { outcome: RESTARTED, steps: [] }; },
    RESTARTED,
    ...(handoff ? { handoffFirst: handoff(events) } : {}),
  };
}

test.afterEach(() => accountmove.resetForTests());

test('a handoff written in time: asked, then restarted, then the new session is pointed at it', async () => {
  let writes = 0;
  const d = deps({ handoff: (events) => ({
    ask: async (n) => { events.push(['ask', n]); return { asked: true, path: '/h/' + n + '.md', before: { exists: false } }; },
    isFresh: () => { writes += 1; return writes >= 3; },   // written on the third look
    pickup: async (n, path) => { events.push(['pickup', n, path]); },
    waitMs: 2000, pollMs: 5,
  }) });
  const out = accountmove.start({ dir: '/acct/spare', names: ['al'] }, d);
  await out.done; await tick();
  assert.deepEqual(d.events, [['ask', 'al'], ['restart', 'al'], ['pickup', 'al', '/h/al.md']], 'ask, then restart, then the pickup: in that order');
  const a = accountmove.read(out.body.id).agents[0];
  assert.equal(a.outcome, 'changed');
  assert.match(a.because, /It is starting again, and it picks up from its handoff\./);
  assert.match(a.because, /It wrote a handoff first, and its new session is pointed at it\.$/);
});

test('a handoff not written in time: the move goes ahead, says so, and sends no pickup', async () => {
  const d = deps({ handoff: (events) => ({
    ask: async (n) => { events.push(['ask', n]); return { asked: true, path: '/h/' + n + '.md', before: { exists: true, mtimeMs: 1 } }; },
    isFresh: () => false,
    pickup: async (n) => { events.push(['pickup', n]); },
    waitMs: 40, pollMs: 5,
  }) });
  const out = accountmove.start({ dir: '/acct/spare', names: ['al'] }, d);
  await out.done; await tick();
  assert.deepEqual(d.events, [['ask', 'al'], ['restart', 'al']], 'restarted anyway, and no pickup for a handoff that was not written');
  const a = accountmove.read(out.body.id).agents[0];
  assert.equal(a.outcome, 'changed');
  assert.match(a.because, /it will look idle until you say something to it/);
  assert.match(a.because, /It did not write its handoff in time, so its new session starts without one\.$/);
});

test('an agent that cannot be asked (out of usage) is moved with the reason said', async () => {
  const d = deps({ handoff: (events) => ({
    ask: async () => ({ asked: false, why: 'it was out of usage, so it could not write one.' }),
    isFresh: () => { throw new Error('never looked at'); },
    pickup: async (n) => { events.push(['pickup', n]); },
  }) });
  const out = accountmove.start({ dir: '/acct/spare', names: ['al'] }, d);
  await out.done; await tick();
  assert.deepEqual(d.events, [['restart', 'al']]);
  assert.match(accountmove.read(out.body.id).agents[0].because, /It was not asked to write a handoff first: it was out of usage, so it could not write one\.$/);
});

test('an ask that throws is "not asked", and never stops the move', async () => {
  const d = deps({ handoff: () => ({ ask: async () => { throw new Error('boom'); }, isFresh: () => true, pickup: async () => {} }) });
  const out = accountmove.start({ dir: '/acct/spare', names: ['al'] }, d);
  await out.done;
  const a = accountmove.read(out.body.id).agents[0];
  assert.equal(a.outcome, 'changed');
  assert.match(a.because, /not asked to write a handoff first: we could not reach it\./);
});

test('CONTROL: with the step off (no handoffFirst), the move is as before: no ask, no pickup, the old words', async () => {
  const d = deps();
  const out = accountmove.start({ dir: '/acct/spare', names: ['al'] }, d);
  await out.done;
  assert.deepEqual(d.events, [['restart', 'al']]);
  const a = accountmove.read(out.body.id).agents[0];
  assert.match(a.because, /^al runs on spare@example\.com now\. It is starting again, and it will look idle until you say something to it\. Everything it has done comes with it\.$/);
});

test('a stop during the wait puts the agent back rather than restarting it', async () => {
  let release;
  const d = deps({ handoff: (events) => ({
    ask: async (n) => { events.push(['ask', n]); return { asked: true, path: '/h/' + n, before: { exists: false } }; },
    isFresh: () => false,
    pickup: async () => {},
    waitMs: 5000, pollMs: 5,
  }) });
  d.readAccount = () => '/acct/old';
  d.putBack = () => ({ outcome: 'changed' });
  const out = accountmove.start({ dir: '/acct/spare', names: ['al'] }, d);
  await until(() => d.events.length === 1);
  accountmove.stop(out.body.id);
  await out.done;
  assert.deepEqual(d.events, [['ask', 'al']], 'not restarted after the stop');
  release = accountmove.read(out.body.id).agents[0];
  assert.notEqual(release.outcome, 'changed');
});
