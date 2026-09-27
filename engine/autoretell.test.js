'use strict';

/**
 * #3932: engine/autoretell.js decides which could_not members to re-tell once their instruction
 * file has changed. Pure: the projects list, the mtime reader, the clock and the retell are injected.
 *
 *   node --test engine/autoretell.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { due, sweepOnce, SETTLE_MS, COULD_NOT } = require('./autoretell');

const T0 = Date.parse('2026-09-27T08:00:00.000Z');
const at = (ms) => new Date(ms).toISOString();
const couldNot = (ms) => ({ state: 'could_not', because: 'it has no instructions file yet, and we will not create one', at: at(ms) });
const told = (ms) => ({ state: 'told', because: null, at: at(ms) });

/* One project, `ada` on it with a could_not verdict at T0, her file changed at T0 + 1s. */
function world(over = {}) {
  return {
    projects: [{ id: 'p1', agents: ['ada'], told: { ada: couldNot(T0) } }],
    mtimeOf: (name) => (name === 'ada' ? T0 + 1000 : null),
    now: T0 + 1000 + SETTLE_MS,
    acted: new Map(),
    ...over,
  };
}

test('the could_not this module matches is the one projects.js stores', () => {
  assert.equal(COULD_NOT, require('./projects').TOLD.COULD_NOT);
});

test('a could_not member whose file changed after the verdict, and has been still since, is due', () => {
  assert.deepEqual(due(world()), [{ name: 'ada', id: 'p1', mtime: T0 + 1000 }]);
});

test('a file unchanged since the verdict is not due (a retry would fail the same way)', () => {
  assert.deepEqual(due(world({ mtimeOf: () => T0 })), [], 'mtime equal to the verdict');
  assert.deepEqual(due(world({ mtimeOf: () => T0 - 5000 })), [], 'mtime older than the verdict');
});

test('a file changed within the settle window is not due yet, and is once the window passes', () => {
  assert.deepEqual(due(world({ now: T0 + 1000 + SETTLE_MS - 1 })), [], 'acted on a file that may still be open mid-edit');
  assert.equal(due(world({ now: T0 + 1000 + SETTLE_MS })).length, 1, 'CONTROL: the same file once it has been still for the window');
});

test('only could_not verdicts count: told and not_tried members are never re-told', () => {
  for (const t of [told(T0), { state: 'not_tried', because: null, at: at(T0) }]) {
    const w = world({ projects: [{ id: 'p1', agents: ['ada'], told: { ada: t } }] });
    assert.deepEqual(due(w), [], 'a ' + t.state + ' member was re-told');
  }
});

test('a member who left is not re-told, even with a could_not verdict still stored', () => {
  const w = world({ projects: [{ id: 'p1', agents: [], told: { ada: couldNot(T0) } }] });
  assert.deepEqual(due(w), []);
});

test('no file, an unreadable file, or a verdict with no time is not due', () => {
  assert.deepEqual(due(world({ mtimeOf: () => null })), [], 'no file');
  assert.deepEqual(due(world({ mtimeOf: () => { throw new Error('EACCES'); } })), [], 'a stat that throws');
  const w = world({ projects: [{ id: 'p1', agents: ['ada'], told: { ada: { state: 'could_not', because: 'x' } } }] });
  assert.deepEqual(due(w), [], 'a verdict with no `at`');
});

test('the NEWEST could_not verdict across projects is the one the file must be newer than', () => {
  // An older verdict on p1, a newer one on p2; the file changed between them.
  const w = world({
    projects: [
      { id: 'p1', agents: ['ada'], told: { ada: couldNot(T0 - 60000) } },
      { id: 'p2', agents: ['ada'], told: { ada: couldNot(T0 + 5000) } },
    ],
    mtimeOf: () => T0,
    now: T0 + 60000,
  });
  assert.deepEqual(due(w), [], 'a file older than the newest verdict was treated as a fix');
  // CONTROL: a file newer than both is due, answered against the newest verdict's project.
  assert.deepEqual(due({ ...w, mtimeOf: () => T0 + 6000 }), [{ name: 'ada', id: 'p2', mtime: T0 + 6000 }]);
});

test('one retell per change: a second sweep with no new change does nothing, a new change acts again', () => {
  const w = world();
  const calls = [];
  const retell = (name, id) => { calls.push([name, id]); return { told: { state: 'could_not' } }; };
  // The retell leaves the stored verdict could_not at T0 (a stub that writes nothing): only the
  // memory stops a repeat.
  assert.deepEqual(sweepOnce({ ...w, retell }), [{ name: 'ada', id: 'p1', state: 'could_not' }]);
  assert.deepEqual(sweepOnce({ ...w, retell, now: w.now + 60000 }), [], 'the same change was acted on twice');
  assert.deepEqual(calls, [['ada', 'p1']]);
  // A further edit is a new change.
  const later = { ...w, mtimeOf: () => T0 + 90000, now: T0 + 90000 + SETTLE_MS };
  assert.equal(sweepOnce({ ...later, retell }).length, 1, 'a second, separate fix was never acted on');
  assert.equal(calls.length, 2);
});

test('an agent not ready (running on a person\'s unread change) is left, and the change is not spent', () => {
  const w = world();
  let isReady = false;
  const calls = [];
  const retell = (name) => { calls.push(name); return { told: { state: 'told' } }; };
  assert.deepEqual(sweepOnce({ ...w, ready: () => isReady, retell }), [], 'retold an agent that was not ready');
  assert.deepEqual(sweepOnce({ ...w, ready: () => { throw new Error('x'); }, retell }), [], 'a ready check that throws was read as ready');
  isReady = true;   // it restarted
  assert.deepEqual(sweepOnce({ ...w, ready: () => isReady, retell, now: w.now + 60000 }).map((r) => r.name), ['ada'],
    'the change was spent while the agent was not ready, so it was never retold');
  assert.deepEqual(calls, ['ada']);
});

test('a newer told verdict on another project wins over an older could_not', () => {
  const w = world({
    projects: [
      { id: 'p1', agents: ['ada'], told: { ada: couldNot(T0) } },
      { id: 'p2', agents: ['ada'], told: { ada: told(T0 + 500) } },
    ],
  });
  assert.deepEqual(due(w), [], 'retold an agent whose newest verdict is told');
  // CONTROL: the order reversed, could_not newest, is due.
  const r = world({ projects: [
    { id: 'p1', agents: ['ada'], told: { ada: told(T0 - 500) } },
    { id: 'p2', agents: ['ada'], told: { ada: couldNot(T0) } },
  ] });
  assert.deepEqual(due(r).map((d) => d.id), ['p2']);
});

test('a retell that throws is recorded as an error and does not stop the next agent', () => {
  const w = world({
    projects: [{ id: 'p1', agents: ['ada', 'bo'], told: { ada: couldNot(T0), bo: couldNot(T0) } }],
    mtimeOf: () => T0 + 1000,
  });
  const calls = [];
  const retell = (name) => { calls.push(name); if (name === 'ada') throw new Error('boom'); return { told: { state: 'told' } }; };
  const rows = sweepOnce({ ...w, retell });
  assert.deepEqual(rows, [{ name: 'ada', id: 'p1', state: 'error' }, { name: 'bo', id: 'p1', state: 'told' }]);
  assert.deepEqual(calls, ['ada', 'bo']);
  // The failed change is remembered too: it is not hammered every sweep.
  assert.deepEqual(sweepOnce({ ...w, retell }), []);
});
