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
const projects = require('./projects');
const tasks = require('./tasks');
const taskchat = require('./taskchat');
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
  assert.equal(of(p, 2), null, 'under an open parent: work still going on');
  assert.equal(of(p, 3), null, 'no parent');
  assert.equal(of(p, 4), null, 'a parent number that is not a task here');
  const replaced = project([{ ...cycle, replacedBy: 5 }, agentTask(2), { number: 5, createdAt: at(19), addedVia: 'screen' }]);
  assert.equal(of(replaced, 2), null, 'a parent replaced by another task moved on; it did not finish');
});

test('every task above the parent must be finished too: a closed step of open work is work still going on', () => {
  const top = { number: 1, sentence: 'open top', createdAt: at(1), addedVia: 'screen' };
  const step = { number: 2, sentence: 'closed step', parent: 1, createdAt: at(2), closedAt: at(20), addedVia: 'screen' };
  const p = project([top, step, agentTask(3, { parent: 2 })]);
  assert.equal(of(p, 3), null, 'its parent is closed but the top task is open');
  const done = project([{ ...top, closedAt: at(22) }, step, agentTask(3, { parent: 2 })]);
  assert.equal(of(done, 3), 2, 'CONTROL: with the top task finished too, offered under its own parent');
  const replacedTop = project([{ ...top, closedAt: at(22), replacedBy: 9 }, step, agentTask(3, { parent: 2 }), { number: 9, createdAt: at(21), addedVia: 'screen' }]);
  assert.equal(of(replacedTop, 3), null, 'a top task replaced by another: that work moved on');
});

test('the history allow-list against the engine\'s own writers: an agent\'s untouched task passes; the person\'s acts do not', () => {
  const pr = projects.create({ name: 'Writers 7151' });
  projects.addAgent(pr.id, 'kit');
  const made = (by) => tasks.create(pr.id, { sentence: 'Diagnostic ' + by, made: { via: 'process', by } }).number;
  const untouched = made('kit');
  assert.ok(tasks.agentOnlyHistory(taskchat.read(pr.id, untouched)), 'CONTROL: made by an agent and left alone');
  const due = made('kit'); tasks.setDue(pr.id, due, '2026-12-01'); tasks.setDue(pr.id, due, null);
  assert.equal(tasks.agentOnlyHistory(taskchat.read(pr.id, due)), false, 'a due date set and cleared');
  const held = made('kit'); tasks.setOnHold(pr.id, held, true, { viaScreen: true }); tasks.setOnHold(pr.id, held, false, { viaScreen: true });
  assert.equal(tasks.agentOnlyHistory(taskchat.read(pr.id, held)), false, 'a hold set and released on the screen');
  const said = made('kit'); tasks.say(pr.id, said, 'a word from the screen');
  assert.equal(tasks.agentOnlyHistory(taskchat.read(pr.id, said)), false, 'a message (a said row names nobody)');
  const noName = made('kit'); tasks.setOnHold(pr.id, noName, true); tasks.setOnHold(pr.id, noName, false);
  assert.equal(tasks.agentOnlyHistory(taskchat.read(pr.id, noName)), false, 'a hold set and cleared off the screen names nobody (it could be the person\'s terminal)');
  const theirs = tasks.create(pr.id, { sentence: 'From the screen' }).number;
  assert.equal(tasks.agentOnlyHistory(taskchat.read(pr.id, theirs)), false, 'the person made it');
});

test('a task with an open task under it is not offered; with every child closed it is', () => {
  const p = project([cycle, agentTask(2), { number: 3, parent: 2, createdAt: at(6), addedVia: 'screen' }]);
  assert.equal(of(p, 2), null, 'its child is still open');
  const closed = project([cycle, agentTask(2), { number: 3, parent: 2, createdAt: at(6), addedVia: 'process', addedBy: 'kit', closedAt: at(8) }]);
  assert.equal(of(closed, 2), 1, 'CONTROL: its child closed (and an agent\'s)');
});

test('every task under it, at any depth, must be closed and an agent\'s', () => {
  const child = (n, parent, extra = {}) => ({ number: n, parent, createdAt: at(6), addedVia: 'process', addedBy: 'kit', closedAt: at(8), ...extra });
  const grand = project([cycle, agentTask(2), child(3, 2), child(4, 3, { closedAt: undefined })]);
  assert.equal(of(grand, 2), null, 'a grandchild still open (review 4)');
  const theirs = project([cycle, agentTask(2), child(3, 2, { addedVia: 'screen' })]);
  assert.equal(of(theirs, 2), null, 'a step the person added, even closed (review 4)');
  const ok = project([cycle, agentTask(2), child(3, 2), child(4, 3)]);
  assert.equal(of(ok, 2), 1, 'CONTROL: every task below closed and an agent\'s');
  const loop = project([cycle, agentTask(2), child(3, 2), { ...child(4, 3), parent: 3 }]);
  assert.equal(of(loop, 2), 1, 'a repeated child is visited once');
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
const AGENT_HISTORY = [{ at: at(5), kind: 'created', addedVia: 'process', addedBy: 'kit' }];
const rowOf = (p, n) => ({ ...p.tasks.find((t) => t.number === n), projectId: p.id });

test('retireOffers: an offered row, and the roster read only when some row would be offered', () => {
  const p = project([cycle, agentTask(2), agentTask(3, { addedVia: 'screen' })]);
  let reads = 0;
  const roster = () => { reads += 1; return [{ ...realCard('kit'), state: 'working' }]; };
  const offers = tasks.retireOffers([rowOf(p, 2), rowOf(p, 3)], [p], roster, () => AGENT_HISTORY);
  assert.deepEqual([...offers], [[0, 1]]);
  assert.equal(reads, 1);
  const none = tasks.retireOffers([rowOf(p, 3)], [p], roster, () => AGENT_HISTORY);
  assert.equal(none.size, 0);
  assert.equal(reads, 1, 'no candidate: the roster is not read');
});

test('retireOffers: never one whose agent needs the person about it (a real card, and the control)', () => {
  const p = project([cycle, agentTask(2, { parts: [{ who: 'kit', addedVia: 'process' }] })]);
  const card = realCard('kit');
  const asking = tasks.retireOffers([rowOf(p, 2)], [p], () => [{ ...card, state: 'needs_you', stateProject: p.id }], () => AGENT_HISTORY);
  assert.equal(asking.size, 0, 'kit is asking the person about this project');
  const elsewhere = tasks.retireOffers([rowOf(p, 2)], [p], () => [{ ...card, state: 'needs_you', stateProject: 'another' }], () => AGENT_HISTORY);
  assert.equal(elsewhere.get(0), 1, 'CONTROL: a question about another project leaves it offered');
});

test('retireOffers: never one whose filer is asking the person about this project, even unassigned (review 4)', () => {
  const p = project([cycle, agentTask(2)]);
  const card = realCard('kit');
  const asking = tasks.retireOffers([rowOf(p, 2)], [p], () => [{ ...card, state: 'needs_you', stateProject: p.id }], () => AGENT_HISTORY);
  assert.equal(asking.size, 0, 'nobody is on it, and kit, who filed it, is asking about this project');
  const elsewhere = tasks.retireOffers([rowOf(p, 2)], [p], () => [{ ...card, state: 'needs_you', stateProject: 'another' }], () => AGENT_HISTORY);
  assert.equal(elsewhere.get(0), 1, 'CONTROL: about another project');
});

test('retireOffers: a roster that cannot be read offers nothing, never everything', () => {
  const p = project([cycle, agentTask(2)]);
  assert.equal(tasks.retireOffers([rowOf(p, 2)], [p], () => null, () => AGENT_HISTORY).size, 0, 'null');
  assert.equal(tasks.retireOffers([rowOf(p, 2)], [p], () => { throw new Error('no snapshot'); }, () => AGENT_HISTORY).size, 0, 'a throw');
  assert.equal(tasks.retireOffers([rowOf(p, 2)], [p], () => [], () => AGENT_HISTORY).get(0), 1, 'CONTROL: an empty roster that was read');
});

test('retireOffers: the history rules it out when the person acted, or it was re-parented or reopened', () => {
  const p = project([cycle, agentTask(2)]);
  const created = { at: at(5), kind: 'created', addedVia: 'process', addedBy: 'kit' };
  const offer = (history) => tasks.retireOffers([rowOf(p, 2)], [p], () => [], () => history).get(0);
  assert.equal(offer([created, { at: at(6), kind: 'assigned', who: 'kit', by: 'kit' }]), 1, 'CONTROL: only an agent\'s own rows');
  assert.equal(offer([created, { at: at(6), kind: 'done-when-set', person: true }]), undefined, 'the person acted on it');
  assert.equal(offer([created, { at: at(6), kind: 'said', text: 'from the screen or not, nothing says' }]), undefined, 'a message with no sender');
  assert.equal(offer([created, { at: at(6), kind: 'hold-cleared', via: 'screen' }]), undefined, 'a hold the person cleared');
  assert.equal(offer([]), undefined, 'no history (or one that could not be read: the reader answers the same)');
  assert.equal(offer([{ at: at(6), kind: 'assigned', who: 'kit', by: 'kit' }]), undefined, 'a history that does not begin with its creation');
  assert.equal(offer([created, { at: at(21), kind: 'parent-set', parent: 1 }]), undefined, 'moved under its parent after it was made');
  assert.equal(offer([created, { at: at(21), kind: 'reopened' }]), undefined, 'reopened');
  assert.equal(tasks.retireOffers([rowOf(p, 2)], [p], () => [], () => null).size, 0, 'a history that cannot be read');
  assert.equal(tasks.retireOffers([rowOf(p, 2)], [p], () => [], () => { throw new Error('x'); }).size, 0, 'a history read that throws');
});

test('retireOffers: a project held in two records is never offered', () => {
  const a = project([cycle, agentTask(2)]);
  const b = project([{ ...cycle, closedAt: undefined }, agentTask(2)]);
  assert.equal(tasks.retireOffers([rowOf(a, 2)], [a, b], () => [], () => AGENT_HISTORY).size, 0);
  assert.equal(tasks.retireOffers([rowOf(a, 2)], [a], () => [], () => AGENT_HISTORY).get(0), 1, 'CONTROL: one record');
});

const body = (rows) => ({ tasks: rows, count: rows.length, listState: 'open', quietDays: 7, project: 'p' });
const lines = (rows, opts = { project: 'p', days: 7 }) => tasklist.acrossLines(body(rows), 'stale', { ...opts, now: Date.parse(at(25)) }).lines;

test('the stale list marks each offered task and says the rule once; nothing else changes', () => {
  const out = lines([{ number: 2, whoNames: ['kit'], sentence: 'diag', lastActivityAt: at(5), leftUnder: 1 },
    { number: 3, whoNames: [], sentence: 'other', lastActivityAt: at(6) }]);
  assert.equal(out[0], '#2  open  kit  diag  (quiet 20 days, left under closed task #1)');
  assert.equal(out[1], '#3  open  nobody  other  (quiet 19 days)', 'a task not offered reads as before');
  assert.equal(out[3], '1 of these looks left over: added by an agent, and the work it was part of has since finished.', out.join('\n'));
  assert.equal(out[4], 'If one is yours and you are sure it is done with, close it: kosmos task close p <task-number>.', 'the one project named');
  assert.ok(out[5].startsWith('Only offered when an agent did everything on it so far: never one the person added, set up or touched'), out[5]);
  assert.equal(out.filter((l) => l.includes('left over')).length, 1, 'the rule is said once');
  assert.ok(out.every((l) => l.length <= 200), 'no line of the rule runs past 200 characters');
});

test('two offered say so in the plural; none offered adds no line; --all leaves the project to fill in', () => {
  const two = lines([{ number: 2, sentence: 'a', lastActivityAt: at(5), leftUnder: 1 }, { number: 3, sentence: 'b', lastActivityAt: at(5), leftUnder: 1 }]);
  assert.ok(two.includes('2 of these look left over: added by an agent, and the work they were part of has since finished.'), two.join('\n'));
  const none = lines([{ number: 3, sentence: 'b', lastActivityAt: at(5) }]);
  assert.ok(!none.some((l) => l.includes('left over')), none.join('\n'));
  const junk = lines([{ number: 3, sentence: 'b', lastActivityAt: at(5), leftUnder: '1' }]);
  assert.ok(!junk.some((l) => l.includes('left over') || l.includes('left under')), 'only a whole number from the board counts');
  const all = tasklist.acrossLines({ ...body([{ projectId: 'p', number: 2, sentence: 'a', lastActivityAt: at(5), leftUnder: 1 }]), all: true, project: null },
    'stale', { project: '', days: 7, now: Date.parse(at(25)) }).lines;
  assert.ok(all.some((l) => l.includes('kosmos task close <project-id> <task-number>')), all.join('\n'));
});
