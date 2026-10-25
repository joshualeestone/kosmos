'use strict';

/**
 * kosmos#7151 (feedback: tasks left behind by finished cycles pile up across releases): tasks.leftUnder, the rule the
 * stale list offers a task for retiring by, and tasklist.acrossLines, which prints the offer and the rule.
 *
 *   node --test engine/tasks.leftunder-7151.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const tasks = require('./tasks');
const tasklist = require('./tasklist');

const at = (d) => '2026-10-' + String(d).padStart(2, '0') + 'T00:00:00.000Z';
const project = (list) => ({ tasks: list });
const cycle = { number: 1, sentence: 'the cycle', createdAt: at(1), closedAt: at(20), addedVia: 'screen' };
const of = (p, n) => tasks.leftUnder(p, p.tasks.find((t) => t.number === n));

test('an agent\'s or the Assigner\'s open task made before a task above it closed is offered under it', () => {
  const p = project([cycle,
    { number: 2, parent: 1, createdAt: at(5), addedVia: 'process' },
    { number: 3, parent: 1, createdAt: at(5), addedVia: 'assigner' },
    { number: 4, parent: 2, createdAt: at(6), addedVia: 'process' }]);
  assert.equal(of(p, 2), 1, 'filed by an agent');
  assert.equal(of(p, 3), 1, 'filed by the Assigner');
  assert.equal(of(p, 4), 1, 'a grandchild, its own parent open: the closed grandparent');
});

test('never offered: the person\'s own, a follow-up filed after the close, no parent, an open parent, or no dates', () => {
  const p = project([cycle, { number: 9, sentence: 'open parent', createdAt: at(1), addedVia: 'screen' },
    { number: 2, parent: 1, createdAt: at(5), addedVia: 'screen' },
    { number: 3, parent: 1, createdAt: at(5) },
    { number: 4, parent: 1, createdAt: at(21), addedVia: 'process' },
    { number: 5, parent: 1, createdAt: at(20), addedVia: 'process' },
    { number: 6, createdAt: at(5), addedVia: 'process' },
    { number: 7, parent: 9, createdAt: at(5), addedVia: 'process' },
    { number: 8, parent: 1, addedVia: 'process' },
    { number: 10, parent: 99, createdAt: at(5), addedVia: 'process' }]);
  assert.equal(of(p, 2), null, 'the person added it');
  assert.equal(of(p, 3), null, 'no record of who added it reads as the person\'s');
  assert.equal(of(p, 4), null, 'filed after the parent closed: new work');
  assert.equal(of(p, 5), null, 'filed at the very moment it closed: not before, so not offered');
  assert.equal(of(p, 6), null, 'no parent');
  assert.equal(of(p, 7), null, 'its parent is still open');
  assert.equal(of(p, 8), null, 'no date of its own');
  assert.equal(of(p, 10), null, 'a parent number that is not a task here');
  const undated = project([{ number: 1, closedAt: 'not a date', addedVia: 'screen' }, { number: 2, parent: 1, createdAt: at(5), addedVia: 'process' }]);
  assert.equal(of(undated, 2), null, 'a close with no readable date');
});

test('only open tasks are offered: never one done, built (waiting on review) or on hold', () => {
  const p = project([cycle,
    { number: 2, parent: 1, createdAt: at(5), addedVia: 'process', closedAt: at(22) },
    { number: 3, parent: 1, createdAt: at(5), addedVia: 'process', builtAt: at(10) },
    { number: 4, parent: 1, createdAt: at(5), addedVia: 'process', onHold: true },
    { number: 5, parent: 1, createdAt: at(5), addedVia: 'process' }]);
  assert.equal(of(p, 2), null, 'done');
  assert.equal(of(p, 3), null, 'built, waiting on review');
  assert.equal(of(p, 4), null, 'on hold');
  assert.equal(of(p, 5), 1, 'CONTROL: the same task open is offered');
});

test('a parent closed by all its parts closes when its last part did', () => {
  const byParts = { number: 1, createdAt: at(1), addedVia: 'screen', parts: [{ who: 'a', closedAt: at(10) }, { who: 'b', closedAt: at(18) }] };
  assert.equal(tasks.closedAtOf(byParts), at(18), 'the latest part');
  const p = project([byParts, { number: 2, parent: 1, createdAt: at(15), addedVia: 'process' }, { number: 3, parent: 1, createdAt: at(19), addedVia: 'process' }]);
  assert.equal(of(p, 2), 1, 'made before the last part closed');
  assert.equal(of(p, 3), null, 'made after');
  assert.equal(tasks.closedAtOf({ number: 1, parts: [{ who: 'a', closedAt: at(1) }, { who: 'b' }] }), null, 'a part still open: not closed');
});

test('a store whose parents loop ends rather than spinning', () => {
  const p = project([{ number: 1, parent: 2, createdAt: at(1), addedVia: 'process' }, { number: 2, parent: 1, createdAt: at(1), addedVia: 'process' }]);
  assert.equal(of(p, 1), null);
});

const body = (rows) => ({ tasks: rows, count: rows.length, listState: 'open', quietDays: 7, project: 'p' });
const lines = (rows, opts = { project: 'p', days: 7 }) => tasklist.acrossLines(body(rows), 'stale', { ...opts, now: Date.parse(at(25)) }).lines;

test('the stale list marks each offered task and says the rule once; nothing else changes', () => {
  const out = lines([{ number: 2, whoNames: ['kit'], sentence: 'diag', lastActivityAt: at(5), leftUnder: 1 },
    { number: 3, whoNames: [], sentence: 'other', lastActivityAt: at(6) }]);
  assert.equal(out[0], '#2  open  kit  diag  (quiet 20 days, left under closed task #1)');
  assert.equal(out[1], '#3  open  nobody  other  (quiet 19 days)', 'a task not offered reads as before');
  const rule = out.find((l) => l.startsWith('1 of these was added by an agent before the task above it closed'));
  assert.ok(rule, out.join('\n'));
  assert.ok(rule.includes('kosmos task close <project-id> <task-number>') && rule.includes('Never offered: a task the person added'), rule);
  assert.equal(out.filter((l) => l.includes('probably left over')).length, 1, 'the rule is said once');
});

test('two offered say so in the plural; none offered adds no line', () => {
  const two = lines([{ number: 2, sentence: 'a', lastActivityAt: at(5), leftUnder: 1 }, { number: 3, sentence: 'b', lastActivityAt: at(5), leftUnder: 1 }]);
  assert.ok(two.some((l) => l.startsWith('2 of these were added by an agent before the task above them closed, so they are probably')), two.join('\n'));
  const none = lines([{ number: 3, sentence: 'b', lastActivityAt: at(5) }]);
  assert.ok(!none.some((l) => l.includes('left over')), none.join('\n'));
  const junk = lines([{ number: 3, sentence: 'b', lastActivityAt: at(5), leftUnder: '1' }]);
  assert.ok(!junk.some((l) => l.includes('left over') || l.includes('left under')), 'only a whole number from the board counts');
});
