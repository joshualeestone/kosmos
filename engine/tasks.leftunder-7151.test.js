'use strict';

/**
 * kosmos#7151 (feedback: tasks left behind by finished cycles pile up across releases): tasks.leftUnder and
 * tasks.retireOffers, the rule the stale list offers a task for retiring by, and tasklist.acrossLines, which prints the
 * offer and the rule. The rule is strict on purpose: any sign the person may still want a task means no offer.
 *
 *   node --test engine/tasks.leftunder-7151.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const nodePath = require('node:path');

process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-leftunder-'));
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-leftunder-data-'));
process.on('exit', () => {
  for (const d of [process.env.AGENT_WORKFORCE_PROJECTS, process.env.AGENT_WORKFORCE_DATA]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});
const tasks = require('./tasks');
const tasklist = require('./tasklist');
const fleet = require('../test-support/fleet');

const at = (d) => '2026-10-' + String(d).padStart(2, '0') + 'T00:00:00.000Z';
const project = (list, extra = {}) => ({ id: 'p7151', agents: ['kit'], tasks: list, ...extra });
const cycle = { number: 1, sentence: 'the cycle', createdAt: at(1), closedAt: at(20), addedVia: 'screen' };
const agentTask = (n, extra = {}) => ({ number: n, parent: 1, createdAt: at(5), addedVia: 'process', addedBy: 'kit', ...extra });
const of = (p, n) => tasks.leftUnder(p, p.tasks.find((t) => t.number === n));

test('an agent\'s open task made before its parent closed is offered under it', () => {
  const p = project([cycle, agentTask(2)]);
  assert.equal(of(p, 2), 1);
});

test('never offered: who filed it is not an agent it names', () => {
  const p = project([cycle,
    agentTask(2, { addedVia: 'screen' }), agentTask(3, { addedVia: undefined }), agentTask(4, { addedBy: undefined }),
    agentTask(5, { addedBy: '  ' }), agentTask(6, { addedVia: 'assigner' }), agentTask(7, { addedVia: 'webhook' })]);
  for (const n of [2, 3, 4, 5, 6, 7]) assert.equal(of(p, n), null, 'task ' + n);
});

test('never offered: anything on it the person set up (repeat, due date, done-when, a part from the screen)', () => {
  const p = project([cycle,
    agentTask(2, { repeat: { every: 'week' } }), agentTask(3, { dueDate: '2026-11-01' }), agentTask(4, { doneWhen: 'the box is green' }),
    agentTask(5, { parts: [{ who: 'kit', addedVia: 'screen' }] }), agentTask(6, { parts: [{ who: 'kit', addedVia: 'process', movedVia: 'screen' }] }),
    agentTask(7, { parts: [{ who: 'kit', addedVia: 'process' }] })]);
  for (const n of [2, 3, 4, 5, 6]) assert.equal(of(p, n), null, 'task ' + n);
  assert.equal(of(p, 7), 1, 'CONTROL: an agent\'s own part leaves it offered');
});

test('never offered: a follow-up filed after its parent closed, at the same moment, or with no dates', () => {
  const p = project([cycle, agentTask(2, { createdAt: at(21) }), agentTask(3, { createdAt: at(20) }), agentTask(4, { createdAt: undefined })]);
  for (const n of [2, 3, 4]) assert.equal(of(p, n), null, 'task ' + n);
  const undated = project([{ number: 1, closedAt: 'not a date', addedVia: 'screen' }, agentTask(2)]);
  assert.equal(of(undated, 2), null, 'a close with no readable date');
});

test('only the task\'s own parent counts, and only one closed as done', () => {
  const p = project([cycle,
    { number: 9, sentence: 'open middle', parent: 1, createdAt: at(2), addedVia: 'screen' },
    agentTask(2, { parent: 9 }), agentTask(3, { parent: undefined }), agentTask(4, { parent: 99 })]);
  assert.equal(of(p, 2), null, 'under an open parent: work still going on, whatever is above it');
  assert.equal(of(p, 3), null, 'no parent');
  assert.equal(of(p, 4), null, 'a parent number that is not a task here');
  const replaced = project([{ ...cycle, replacedBy: 5 }, agentTask(2), { number: 5, createdAt: at(19), addedVia: 'screen' }]);
  assert.equal(of(replaced, 2), null, 'a parent replaced by another task moved on; it did not finish');
});

test('only open tasks are offered: never one done, built (waiting on review) or on hold', () => {
  const p = project([cycle, agentTask(2, { closedAt: at(22) }), agentTask(3, { builtAt: at(10) }), agentTask(4, { onHold: true }), agentTask(5)]);
  for (const n of [2, 3, 4]) assert.equal(of(p, n), null, 'task ' + n);
  assert.equal(of(p, 5), 1, 'CONTROL: the same task open is offered');
});

test('a parent closed by all its parts closes when its last part did', () => {
  const byParts = { number: 1, createdAt: at(1), addedVia: 'screen', parts: [{ who: 'a', closedAt: at(10) }, { who: 'b', closedAt: at(18) }] };
  assert.equal(tasks.closedAtOf(byParts), at(18), 'the latest part');
  const p = project([byParts, agentTask(2, { createdAt: at(15) }), agentTask(3, { createdAt: at(19) })]);
  assert.equal(of(p, 2), 1, 'made before the last part closed');
  assert.equal(of(p, 3), null, 'made after');
  assert.equal(tasks.closedAtOf({ number: 1, parts: [{ who: 'a', closedAt: at(1) }, { who: 'b' }] }), null, 'a part still open: not closed');
});

/* retireOffers: the rows as the list sends them (allTasks shape: projectId on each), real fleet cards for the roster. */
function realCard(name) {
  const board = fleet.install([fleet.agent(name)], { strict: false });
  try { return { ...board.card(name) }; } finally { board.restore(); }
}
const rowOf = (p, n) => ({ ...p.tasks.find((t) => t.number === n), projectId: p.id });

test('retireOffers: an offered row, and the roster read only when some row would be offered', () => {
  const p = project([cycle, agentTask(2), agentTask(3, { addedVia: 'screen' })]);
  let reads = 0;
  const roster = () => { reads += 1; return [{ ...realCard('kit'), state: 'working' }]; };
  const offers = tasks.retireOffers([rowOf(p, 2), rowOf(p, 3)], [p], roster, () => []);
  assert.deepEqual([...offers], [[0, 1]]);
  assert.equal(reads, 1);
  const none = tasks.retireOffers([rowOf(p, 3)], [p], roster, () => []);
  assert.equal(none.size, 0);
  assert.equal(reads, 1, 'no candidate: the roster is not read');
});

test('retireOffers: never one whose agent needs the person about it (a real card, and the control)', () => {
  const p = project([cycle, agentTask(2, { parts: [{ who: 'kit', addedVia: 'process' }] })]);
  const card = realCard('kit');
  const asking = tasks.retireOffers([rowOf(p, 2)], [p], () => [{ ...card, state: 'needs_you', stateProject: p.id }], () => []);
  assert.equal(asking.size, 0, 'kit is asking the person about this project');
  const elsewhere = tasks.retireOffers([rowOf(p, 2)], [p], () => [{ ...card, state: 'needs_you', stateProject: 'another' }], () => []);
  assert.equal(elsewhere.get(0), 1, 'CONTROL: a question about another project leaves it offered');
});

test('retireOffers: a roster that cannot be read offers nothing, never everything', () => {
  const p = project([cycle, agentTask(2)]);
  assert.equal(tasks.retireOffers([rowOf(p, 2)], [p], () => null, () => []).size, 0, 'null');
  assert.equal(tasks.retireOffers([rowOf(p, 2)], [p], () => { throw new Error('no snapshot'); }, () => []).size, 0, 'a throw');
  assert.equal(tasks.retireOffers([rowOf(p, 2)], [p], () => [], () => []).get(0), 1, 'CONTROL: an empty roster that was read');
});

test('retireOffers: the history rules it out when the person acted, or it was re-parented or reopened', () => {
  const p = project([cycle, agentTask(2)]);
  const offer = (history) => tasks.retireOffers([rowOf(p, 2)], [p], () => [], () => history).get(0);
  assert.equal(offer([{ at: at(6), kind: 'message', by: 'kit' }]), 1, 'CONTROL: an agent\'s own note');
  assert.equal(offer([{ at: at(6), kind: 'done-when-set', person: true }]), undefined, 'the person acted on it');
  assert.equal(offer([{ at: at(21), kind: 'parent-set', parent: 1 }]), undefined, 'moved under its parent after it was made');
  assert.equal(offer([{ at: at(21), kind: 'reopened' }]), undefined, 'reopened');
  assert.equal(tasks.retireOffers([rowOf(p, 2)], [p], () => [], () => null).size, 0, 'a history that cannot be read');
  assert.equal(tasks.retireOffers([rowOf(p, 2)], [p], () => [], () => { throw new Error('x'); }).size, 0, 'a history read that throws');
});

test('retireOffers: a project held in two records is never offered', () => {
  const a = project([cycle, agentTask(2)]);
  const b = project([{ ...cycle, closedAt: undefined }, agentTask(2)]);
  assert.equal(tasks.retireOffers([rowOf(a, 2)], [a, b], () => [], () => []).size, 0);
  assert.equal(tasks.retireOffers([rowOf(a, 2)], [a], () => [], () => []).get(0), 1, 'CONTROL: one record');
});

const body = (rows) => ({ tasks: rows, count: rows.length, listState: 'open', quietDays: 7, project: 'p' });
const lines = (rows, opts = { project: 'p', days: 7 }) => tasklist.acrossLines(body(rows), 'stale', { ...opts, now: Date.parse(at(25)) }).lines;

test('the stale list marks each offered task and says the rule once; nothing else changes', () => {
  const out = lines([{ number: 2, whoNames: ['kit'], sentence: 'diag', lastActivityAt: at(5), leftUnder: 1 },
    { number: 3, whoNames: [], sentence: 'other', lastActivityAt: at(6) }]);
  assert.equal(out[0], '#2  open  kit  diag  (quiet 20 days, left under closed task #1)');
  assert.equal(out[1], '#3  open  nobody  other  (quiet 19 days)', 'a task not offered reads as before');
  const rule = out.find((l) => l.startsWith('1 of these was added by an agent before the task it is part of was finished'));
  assert.ok(rule, out.join('\n'));
  assert.ok(rule.includes('kosmos task close p <task-number>'), 'the one project named: ' + rule);
  assert.ok(rule.includes('Never offered: a task the person added or set up'), rule);
  assert.equal(out.filter((l) => l.includes('probably left over')).length, 1, 'the rule is said once');
});

test('two offered say so in the plural; none offered adds no line; --all leaves the project to fill in', () => {
  const two = lines([{ number: 2, sentence: 'a', lastActivityAt: at(5), leftUnder: 1 }, { number: 3, sentence: 'b', lastActivityAt: at(5), leftUnder: 1 }]);
  assert.ok(two.some((l) => l.startsWith('2 of these were added by an agent before the task they are part of was finished, so they are probably')), two.join('\n'));
  const none = lines([{ number: 3, sentence: 'b', lastActivityAt: at(5) }]);
  assert.ok(!none.some((l) => l.includes('left over')), none.join('\n'));
  const junk = lines([{ number: 3, sentence: 'b', lastActivityAt: at(5), leftUnder: '1' }]);
  assert.ok(!junk.some((l) => l.includes('left over') || l.includes('left under')), 'only a whole number from the board counts');
  const all = tasklist.acrossLines({ ...body([{ projectId: 'p', number: 2, sentence: 'a', lastActivityAt: at(5), leftUnder: 1 }]), all: true, project: null },
    'stale', { project: '', days: 7, now: Date.parse(at(25)) }).lines;
  assert.ok(all.some((l) => l.includes('kosmos task close <project-id> <task-number>')), all.join('\n'));
});
