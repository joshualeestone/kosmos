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
    pickup: async (n, path) => { events.push(['pickup', n, path]); return { ok: true }; },
    waitMs: 2000, pollMs: 5,
  }) });
  const out = accountmove.start({ dir: '/acct/spare', names: ['al'] }, d);
  await out.done; await tick(); await tick();
  assert.deepEqual(d.events, [['ask', 'al'], ['restart', 'al'], ['pickup', 'al', '/h/al.md']], 'ask, then restart, then the pickup: in that order');
  const a = accountmove.read(out.body.id).agents[0];
  assert.equal(a.outcome, 'changed');
  assert.deepEqual(a.handoff, { asked: true, saved: true, pickup: true }, 'the record says the handoff was saved and picked up');
  assert.match(a.because, /It is starting again, and it picks up from its handoff once its new session is up\./);
  await until(() => /is pointed at it\.$/.test(accountmove.read(out.body.id).agents[0].because));
  assert.match(accountmove.read(out.body.id).agents[0].because, /It wrote a handoff first, and its new session is pointed at it\.$/);
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

test('a stop during the wait puts the agent back rather than restarting it, and tells it to carry on', async () => {
  let release;
  const d = deps({ handoff: (events) => ({
    ask: async (n) => { events.push(['ask', n]); return { asked: true, path: '/h/' + n, before: { exists: false } }; },
    isFresh: () => false,
    pickup: async () => ({ ok: true }),
    carryOn: async (n) => { events.push(['carryOn', n]); },
    waitMs: 5000, pollMs: 5,
  }) });
  d.readAccount = () => '/acct/old';
  d.putBack = () => ({ outcome: 'changed' });
  const out = accountmove.start({ dir: '/acct/spare', names: ['al'] }, d);
  await until(() => d.events.length === 1);
  accountmove.stop(out.body.id);
  await out.done;
  assert.deepEqual(d.events, [['ask', 'al'], ['carryOn', 'al']], 'not restarted after the stop, and told to carry on');
  release = accountmove.read(out.body.id).agents[0];
  assert.equal(release.outcome, 'stopped', 'put back on its old account');
});

test('a handoff still being written is waited for: it counts once its time stops changing', async () => {
  const times = [10, 20, 30, 30];   // three edits, then settled
  let i = 0;
  const d = deps({ handoff: (events) => ({
    ask: async (n) => { events.push(['ask', n]); return { asked: true, path: '/h/' + n, before: { exists: false } }; },
    isFresh: () => times[Math.min(i++, times.length - 1)],
    pickup: async () => ({ ok: true }),
    waitMs: 2000, pollMs: 5,
  }) });
  const out = accountmove.start({ dir: '/acct/spare', names: ['al'] }, d);
  await out.done;
  assert.ok(i >= 4, 'restarted before the handoff stopped changing (looked ' + i + ' times)');
  assert.equal(accountmove.read(out.body.id).agents[0].handoff.saved, true);
});

test('a pickup that does not land is written back to the record', async () => {
  const d = deps({ handoff: () => ({
    ask: async (n) => ({ asked: true, path: '/h/' + n, before: { exists: false } }),
    isFresh: () => true,
    pickup: async () => ({ ok: false }),
    waitMs: 2000, pollMs: 5,
  }) });
  const out = accountmove.start({ dir: '/acct/spare', names: ['al'] }, d);
  await out.done;
  await until(() => accountmove.read(out.body.id).agents[0].handoff.pickup === false);
  assert.match(accountmove.read(out.body.id).agents[0].because, /It wrote a handoff first, but we could not point its new session at it: tell it to read its handoff\.$/);
  assert.doesNotMatch(accountmove.read(out.body.id).agents[0].because, /picks up from its handoff/, 'it says it picks up AND that it could not (review 3)');
});

test('a restart that did not answer RESTARTED after a saved handoff: no pickup, honest words, a line true either way', async () => {
  const d = deps({ handoff: (events) => ({
    ask: async (n) => ({ asked: true, path: '/h/' + n, before: { exists: false } }),
    isFresh: () => true,
    pickup: async (n) => { events.push(['pickup', n]); return { ok: true }; },
    carryOn: async (n) => { events.push(['carryOn', n]); },
    maybeRestarted: async (n, p) => { events.push(['maybeRestarted', n, p]); },
  }) });
  d.restartAsync = async (name) => { d.events.push(['restart', name]); return { outcome: 'partial', because: 'its window could not be closed.', steps: [] }; };
  const out = accountmove.start({ dir: '/acct/spare', names: ['al'] }, d);
  await out.done; await tick();
  assert.deepEqual(d.events, [['restart', 'al'], ['maybeRestarted', 'al', '/h/al']], 'not "carry on": the restart may have happened');
  assert.match(accountmove.read(out.body.id).agents[0].because, /It wrote a handoff first; when it starts again, tell it to read its handoff\.$/);
});

test('fresh at the deadline but not yet seen settled still counts as saved', async () => {
  let n = 0;
  const d = deps({ handoff: () => ({
    ask: async (x) => ({ asked: true, path: '/h/' + x, before: { exists: false } }),
    isFresh: () => { n += 1; return n === 1 ? false : 100 + n; },   // fresh only from the second look, never settled
    pickup: async () => ({ ok: true }),
    waitMs: 30, pollMs: 20,
  }) });
  const out = accountmove.start({ dir: '/acct/spare', names: ['al'] }, d);
  await out.done;
  assert.equal(accountmove.read(out.body.id).agents[0].handoff.saved, true);
});

test('an ask that never answers is bounded: the move goes on, not asked', async () => {
  const d = deps({ handoff: () => ({ ask: () => new Promise(() => {}), isFresh: () => true, pickup: async () => ({ ok: true }), waitMs: 30 }) });
  const out = accountmove.start({ dir: '/acct/spare', names: ['al'] }, d);
  await out.done;
  const a = accountmove.read(out.body.id).agents[0];
  assert.equal(a.outcome, 'changed');
  assert.deepEqual(a.handoff, { asked: false, saved: false, why: 'we could not reach it.' });
});

test('asked, not saved in time, then not restarted: told a line true either way, without a path', async () => {
  const d = deps({ handoff: (events) => ({
    ask: async (n) => ({ asked: true, path: '/h/' + n, before: { exists: false } }),
    isFresh: () => false,
    pickup: async () => ({ ok: true }),
    maybeRestarted: async (n, p) => { events.push(['maybeRestarted', n, p]); },
    waitMs: 20, pollMs: 5,
  }) });
  d.restartAsync = async (name) => { d.events.push(['restart', name]); return { outcome: 'partial', because: 'its window could not be closed.', steps: [] }; };
  const out = accountmove.start({ dir: '/acct/spare', names: ['al'] }, d);
  await out.done; await tick();
  assert.deepEqual(d.events, [['restart', 'al'], ['maybeRestarted', 'al', null]]);
  assert.match(accountmove.read(out.body.id).agents[0].because, /It did not write its handoff in time\.$/);
});

test('a stop during the handoff wait is said as such (Settings does not wait for a restart that will not come)', async () => {
  const d = deps({ handoff: () => ({
    ask: async (n) => ({ asked: true, path: '/h/' + n, before: { exists: false } }),
    isFresh: () => false, pickup: async () => ({ ok: true }), carryOn: async () => {}, waitMs: 5000, pollMs: 5,
  }) });
  d.readAccount = () => '/acct/old';
  d.putBack = () => ({ outcome: 'changed' });
  const out = accountmove.start({ dir: '/acct/spare', names: ['al'] }, d);
  await tick(); await tick();
  const said = accountmove.stop(out.body.id);
  const body = said && said.body ? said.body : said;
  assert.equal(body.waitingForHandoff, true, JSON.stringify(body));
  await out.done;
});

test('an ask that answers after its bound is told the line true either way', async () => {
  let answer;
  const d = deps({ handoff: (events) => ({
    ask: () => new Promise((r) => { answer = r; }),
    isFresh: () => true, pickup: async () => ({ ok: true }),
    maybeRestarted: async (n, p) => { events.push(['maybeRestarted', n, p]); },
    waitMs: 20,
  }) });
  const out = accountmove.start({ dir: '/acct/spare', names: ['al'] }, d);
  await out.done;
  answer({ asked: true, path: '/h/al', before: { exists: false } });   // it was typed after all
  await until(() => d.events.some((e) => e[0] === 'maybeRestarted'));
  assert.deepEqual(d.events.filter((e) => e[0] === 'maybeRestarted'), [['maybeRestarted', 'al', null]]);
});

test('the move does not restart while the ask is still on its way within the budget', async () => {
  let answer;
  const d = deps({ handoff: (events) => ({
    ask: (n) => new Promise((r) => { answer = () => { events.push(['asked', n]); r({ asked: true, path: '/h/' + n, before: { exists: false } }); }; }),
    isFresh: () => 50, pickup: async () => ({ ok: true }), waitMs: 2000, pollMs: 5,
  }) });
  const out = accountmove.start({ dir: '/acct/spare', names: ['al'] }, d);
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(d.events, [], 'restarted while the ask was still on its way');
  answer();
  await out.done;
  assert.deepEqual(d.events.slice(0, 2), [['asked', 'al'], ['restart', 'al']]);
});

test('busy: never settled while busy, but a written handoff still counts at the deadline', async () => {
  let looks = 0;
  const d = deps({ handoff: () => ({
    ask: async (n) => ({ asked: true, path: '/h/' + n, before: { exists: false } }),
    isFresh: () => { looks += 1; return { mtimeMs: 50, busy: true }; },   // written, and the agent never goes idle
    pickup: async () => ({ ok: true }), waitMs: 60, pollMs: 5,
  }) });
  const out = accountmove.start({ dir: '/acct/spare', names: ['al'] }, d);
  await out.done;
  assert.ok(looks >= 3, 'settled while the agent was busy (' + looks + ' looks)');
  assert.equal(accountmove.read(out.body.id).agents[0].handoff.saved, true, 'a written handoff read as not written in time');
});

test('an agent that is not running adds no handoff clause: the move already says so', async () => {
  const d = deps({ handoff: () => ({ ask: async () => ({ asked: false, why: null }), isFresh: () => false, pickup: async () => ({ ok: true }) }) });
  d.restartAsync = async (name) => ({ outcome: 'partial', because: `${name} is not running, so there is nothing to restart.`, steps: [] });
  const out = accountmove.start({ dir: '/acct/spare', names: ['al'] }, d);
  await out.done;
  const a = accountmove.read(out.body.id).agents[0];
  assert.doesNotMatch(a.because, /handoff/, a.because);
  assert.doesNotMatch(a.because, /could not reach it/);
});
