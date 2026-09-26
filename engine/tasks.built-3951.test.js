'use strict';

/**
 * #3951: "built, waiting to ship" on a task, the state behind Josh's "Built but waiting" tile (#3949). An agent (or
 * the person) marks an open task built; closing it, or adding a new part, clears the mark; taskState returns
 * 'built' after 'decision' and before the rest.
 *
 * ⚠️ SANDBOX BOTH ROOTS BEFORE REQUIRING anything that reads them.
 *
 *   node --test engine/tasks.built-3951.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-built-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-built-proj-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('../engine/projects');
const tasks = require('../engine/tasks');
const taskchat = require('../engine/taskchat');

function freshTask(who = 'rex') {
  const p = projects.create({ name: 'Built ' + Math.random().toString(36).slice(2), agents: ['rex'] });
  const made = tasks.create(p.id, { sentence: 'Ship the thing', who });
  return { id: p.id, n: made.number };
}
const stored = (id, n) => tasks.byNumber(projects.readAll().find((x) => x.id === id), n);

test('setBuilt stamps when, who and the note on an open task, and records a built event', () => {
  const { id, n } = freshTask();
  const out = tasks.setBuilt(id, n, { by: 'rex', note: '  waiting on the\nrelease  ' });
  assert.equal(out.ok, true);
  const t = stored(id, n);
  assert.ok(Number.isFinite(Date.parse(t.builtAt)), 'no builtAt');
  assert.equal(t.builtBy, 'rex');
  assert.equal(t.builtNote, 'waiting on the release', 'the note is one line, trimmed');
  const ev = taskchat.read(id, n).find((e) => e.kind === 'built');
  assert.ok(ev && ev.by === 'rex' && ev.note === 'waiting on the release', JSON.stringify(ev));
  assert.equal(tasks.taskState(t), 'built');
});

test('marking again refreshes the builder and the note; with no note the old one does not linger', () => {
  const { id, n } = freshTask();
  tasks.setBuilt(id, n, { by: 'rex', note: 'first' });
  tasks.setBuilt(id, n, { person: true });
  const t = stored(id, n);
  assert.equal(t.builtByPerson, true);
  assert.equal(t.builtBy, null);
  assert.equal('builtNote' in t, false, 'a stale note survived a re-mark with none');
});

test('clearBuilt takes the mark off and records unbuilt; clearing an unmarked task records nothing', () => {
  const { id, n } = freshTask();
  assert.equal(tasks.clearBuilt(id, n, { by: 'rex' }).changed, false);
  assert.equal(taskchat.read(id, n).some((e) => e.kind === 'unbuilt'), false);
  tasks.setBuilt(id, n, { by: 'rex' });
  const out = tasks.clearBuilt(id, n, { by: 'rex' });
  assert.equal(out.ok, true);
  assert.equal(out.changed, true);
  const t = stored(id, n);
  assert.equal('builtAt' in t || 'builtBy' in t, false);
  assert.equal(tasks.taskState(t), 'assigned');
  assert.equal(taskchat.read(id, n).filter((e) => e.kind === 'unbuilt').length, 1);
});

test('closing clears the mark, and reopening does not bring it back', () => {
  const { id, n } = freshTask();
  tasks.setBuilt(id, n, { by: 'rex', note: 'x' });
  tasks.close(id, n);
  assert.equal('builtAt' in stored(id, n), false, 'the mark survived a close');
  tasks.reopen(id, n);
  const t = stored(id, n);
  assert.equal('builtAt' in t, false, 'a reopen brought the mark back');
  assert.equal(tasks.taskState(t), 'assigned');
});

test('the last part closing (the task completes) clears the mark too', () => {
  const { id, n } = freshTask(null);
  tasks.addPart(id, n, { sentence: 'the only piece' });
  tasks.setBuilt(id, n, { person: true });
  const parts = tasks.partsOf(stored(id, n));   // the derived first part and the added one
  assert.ok(parts.length >= 1);
  for (const x of parts.slice(0, -1)) tasks.setPartClosed(id, n, x.id, new Date().toISOString());
  assert.ok('builtAt' in stored(id, n), 'CONTROL: the mark is still there while a part is open');
  const last = parts[parts.length - 1];
  tasks.setPartClosed(id, n, last.id, new Date().toISOString());
  assert.equal(tasks.progressOf(stored(id, n)).closed, true, 'fixture: every part closed completes the task');
  assert.equal('builtAt' in stored(id, n), false, 'a task completed by its parts kept the mark');
  tasks.setPartClosed(id, n, last.id, null);
  assert.equal('builtAt' in stored(id, n), false, 'reopening the part restored the mark');
});

test('adding a new part clears the mark (new work means it is no longer all built)', () => {
  const { id, n } = freshTask();
  tasks.setBuilt(id, n, { by: 'rex' });
  tasks.addPart(id, n, { sentence: 'one more thing' });
  assert.equal('builtAt' in stored(id, n), false);
});

test('a closed task is refused (closed: true), and nothing is stamped or recorded', () => {
  const { id, n } = freshTask();
  tasks.close(id, n);
  const out = tasks.setBuilt(id, n, { by: 'rex' });
  assert.equal(out.ok, false);
  assert.equal(out.closed, true);
  assert.equal('builtAt' in stored(id, n), false);
  assert.equal(taskchat.read(id, n).some((e) => e.kind === 'built'), false);
});

test('an unknown task and an over-long note are refused', () => {
  const { id } = freshTask();
  assert.match(tasks.setBuilt(id, 999, { by: 'rex' }).because, /no task by that number/);
  assert.match(tasks.clearBuilt(id, 999, {}).because, /no task by that number/);
  const { id: id2, n } = freshTask();
  const long = tasks.setBuilt(id2, n, { note: 'x'.repeat(tasks.BUILT_NOTE_MAX + 1) });
  assert.equal(long.ok, false);
  assert.equal('builtAt' in stored(id2, n), false);
});

test('taskState order: closed, then decision, then built, then nobody, working and assigned', () => {
  const built = { number: 1, who: 'rex', builtAt: '2026-09-26T18:00:00Z' };
  assert.equal(tasks.taskState(built), 'built');
  assert.equal(tasks.taskState({ ...built, closedAt: '2026-09-26T19:00:00Z' }), 'closed', 'closed wins');
  assert.equal(tasks.taskState({ ...built, waitingOnPerson: true }), 'decision', 'an agent needing the person wins');
  assert.equal(tasks.taskState({ ...built, claim: { claimed: true } }), 'built', 'built wins over working');
  assert.equal(tasks.taskState({ number: 1, who: null, builtAt: '2026-09-26T18:00:00Z' }), 'built', 'built wins over nobody');
  /* Controls: without the mark the old states stand. */
  assert.equal(tasks.taskState({ number: 1, who: 'rex', claim: { claimed: true } }), 'working');
  assert.equal(tasks.taskState({ number: 1, who: null }), 'nobody');
  assert.equal(tasks.taskState({ number: 1, who: null, waitingOnPerson: true }), 'nobody', 'nobody holds it, so no decision');
});

test('a part put back on a built task is new work: the mark goes, and the history says why (review round 1)', () => {
  const { id, n } = freshTask(null);
  tasks.addPart(id, n, { sentence: 'piece two' });
  const parts = tasks.partsOf(stored(id, n));
  tasks.setPartClosed(id, n, parts[0].id, new Date().toISOString());
  tasks.setBuilt(id, n, { person: true });
  /* Control: re-closing an already closed part is no transition, and keeps the mark. */
  tasks.setPartClosed(id, n, parts[0].id, new Date().toISOString());
  assert.ok('builtAt' in stored(id, n), 'CONTROL: a re-close with no transition dropped the mark');
  tasks.setPartClosed(id, n, parts[0].id, null);
  assert.equal('builtAt' in stored(id, n), false, 'a part put back left the task built');
  const ev = taskchat.read(id, n).filter((e) => e.kind === 'unbuilt').pop();
  assert.ok(ev && ev.reason === 'new work', JSON.stringify(ev));
});

test('adding a part records why the mark went; a close drops it without an unbuilt line (the close says it)', () => {
  const { id, n } = freshTask();
  tasks.setBuilt(id, n, { by: 'rex' });
  tasks.addPart(id, n, { sentence: 'one more' });
  assert.ok(taskchat.read(id, n).some((e) => e.kind === 'unbuilt' && e.reason === 'new work'));
  const { id: id2, n: n2 } = freshTask();
  tasks.setBuilt(id2, n2, { by: 'rex' });
  tasks.close(id2, n2);
  assert.equal(taskchat.read(id2, n2).some((e) => e.kind === 'unbuilt'), false);
});

test('the history reads cause then effect: the part change, then "no longer built" (review round 2)', () => {
  const { id, n } = freshTask();
  tasks.setBuilt(id, n, { by: 'rex' });
  tasks.addPart(id, n, { sentence: 'one more' });
  const kinds = taskchat.read(id, n).map((e) => e.kind);
  assert.ok(kinds.indexOf('part-added') < kinds.lastIndexOf('unbuilt'), JSON.stringify(kinds));
  const { id: id2, n: n2 } = freshTask(null);
  tasks.addPart(id2, n2, { sentence: 'two' });
  const parts = tasks.partsOf(stored(id2, n2));
  tasks.setPartClosed(id2, n2, parts[0].id, new Date().toISOString());
  tasks.setBuilt(id2, n2, { person: true });
  tasks.setPartClosed(id2, n2, parts[0].id, null);
  const k2 = taskchat.read(id2, n2).map((e) => e.kind);
  assert.ok(k2.lastIndexOf('part-reopened') < k2.lastIndexOf('unbuilt'), JSON.stringify(k2));
  /* A part change with no mark to drop records no unbuilt line after it (the flag does not leak). */
  tasks.addPart(id2, n2, { sentence: 'three' });
  assert.equal(taskchat.read(id2, n2).filter((e) => e.kind === 'unbuilt').length, 1);
});

test('the same mark again (same builder and note) writes and records nothing; a changed note does (review round 3)', () => {
  const { id, n } = freshTask();
  tasks.setBuilt(id, n, { by: 'rex', note: 'x' });
  const at = stored(id, n).builtAt;
  const again = tasks.setBuilt(id, n, { by: 'rex', note: 'x' });
  assert.equal(again.ok, true);
  assert.equal(again.changed, false);
  assert.equal(stored(id, n).builtAt, at, 'a repeat refreshed the time');
  assert.equal(taskchat.read(id, n).filter((e) => e.kind === 'built').length, 1, 'a repeat wrote another history line');
  tasks.setBuilt(id, n, { by: 'rex', note: 'y' });
  assert.equal(taskchat.read(id, n).filter((e) => e.kind === 'built').length, 2, 'CONTROL: a changed note is recorded');
});

test('the Assigner does not hand out a built task, and a built task does not keep its agent busy (review round 3)', () => {
  const assigner = require('../engine/assigner');
  const { id, n } = freshTask();
  const nobody = tasks.create(id, { sentence: 'Built with nobody on it' }).number;
  const read = () => projects.readAll().filter((p) => p.id === id);
  /* Controls first: rex is busy with task n, and the unassigned task is up for picking. */
  assert.equal(assigner.hasOpenWork('rex', read()), true, 'CONTROL: an open part keeps rex busy');
  const before = assigner.pick('rex', read(), new Set());
  assert.ok(before && before.n === nobody, 'CONTROL: the unassigned task is picked: ' + JSON.stringify(before));
  tasks.setBuilt(id, n, { by: 'rex' });
  tasks.setBuilt(id, nobody, { person: true });
  assert.equal(assigner.hasOpenWork('rex', read()), false, 'a built task kept its agent busy');
  assert.equal(assigner.pick('rex', read(), new Set()), null, 'a built task was handed out again');
});

test('a mark frees the agent who made it, or every agent when the person made it; another agent\'s part stays busy (review round 4)', () => {
  const assigner = require('../engine/assigner');
  const p = projects.create({ name: 'Shared ' + Math.random().toString(36).slice(2), agents: ['rex', 'mona'] });
  const n = tasks.create(p.id, { sentence: 'Shared work' }).number;
  tasks.addPart(p.id, n, { sentence: 'rex part', who: 'rex' });
  tasks.addPart(p.id, n, { sentence: 'mona part', who: 'mona' });
  const read = () => projects.readAll().filter((x) => x.id === p.id);
  tasks.setBuilt(p.id, n, { by: 'mona' });
  assert.equal(assigner.hasOpenWork('mona', read()), false, 'the builder is freed');
  assert.equal(assigner.hasOpenWork('rex', read()), true, 'another agent with an open part was freed by mona\'s mark');
  tasks.setBuilt(p.id, n, { person: true });
  assert.equal(assigner.hasOpenWork('rex', read()), false, 'the person marking it built did not free the agents on it');
});

test('giving an open part to somebody drops the mark; giving it to the same agent again keeps it (review round 5)', () => {
  const assigner = require('../engine/assigner');
  const { id, n } = freshTask(null);
  tasks.addPart(id, n, { sentence: 'spare part' });
  const spare = tasks.partsOf(stored(id, n)).find((x) => x.sentence === 'spare part');
  tasks.assignPart(id, n, spare.id, 'rex');
  tasks.setBuilt(id, n, { by: 'rex' });
  tasks.assignPart(id, n, spare.id, 'rex');   // CONTROL: a resubmit of the current assignee is no move
  assert.ok('builtAt' in stored(id, n), 'CONTROL: a resubmit dropped the mark');
  tasks.assignPart(id, n, spare.id, null);
  assert.ok('builtAt' in stored(id, n), 'CONTROL: taking somebody off is not new work');
  tasks.assignPart(id, n, spare.id, 'rex');
  assert.equal('builtAt' in stored(id, n), false, 'a part given to rex left the task built');
  assert.equal(assigner.hasOpenWork('rex', projects.readAll().filter((p) => p.id === id)), true, 'rex was given a part and still reads as free');
  assert.ok(taskchat.read(id, n).some((e) => e.kind === 'unbuilt' && e.reason === 'new work'));
});

test('a mark with no named builder frees nobody; the person\'s own mark frees every agent on it (review rounds 8 and 11)', () => {
  const assigner = require('../engine/assigner');
  const { id, n } = freshTask();
  const read = () => projects.readAll().filter((p) => p.id === id);
  tasks.setBuilt(id, n, { by: null });
  assert.equal(stored(id, n).builtBy, null);
  assert.equal(stored(id, n).builtFreesAll === true, false, 'an unnamed caller was given the person\'s power');
  assert.equal(assigner.hasOpenWork('rex', read()), true, 'an unnamed mark freed rex');
  tasks.setBuilt(id, n, { person: true });
  assert.equal(assigner.hasOpenWork('rex', read()), false, 'CONTROL: the person\'s mark frees rex');
});

test('a second agent\'s mark keeps the first one free, and an agent named "operator" is not the person (review round 9)', () => {
  const assigner = require('../engine/assigner');
  const p = projects.create({ name: 'Two ' + Math.random().toString(36).slice(2), agents: ['rex', 'mona', 'operator'] });
  const n = tasks.create(p.id, { sentence: 'Two parts' }).number;
  tasks.addPart(p.id, n, { sentence: 'rex part', who: 'rex' });
  tasks.addPart(p.id, n, { sentence: 'mona part', who: 'mona' });
  tasks.addPart(p.id, n, { sentence: 'operator part', who: 'operator' });
  const read = () => projects.readAll().filter((x) => x.id === p.id);
  tasks.setBuilt(p.id, n, { by: 'mona', note: 'mine' });
  tasks.setBuilt(p.id, n, { by: 'rex', note: 'mine too' });
  assert.deepEqual(stored(p.id, n).builtWho, ['mona', 'rex']);
  assert.equal(assigner.hasOpenWork('mona', read()), false, 'rex\'s mark made mona busy again');
  assert.equal(assigner.hasOpenWork('rex', read()), false);
  assert.equal(assigner.hasOpenWork('operator', read()), true, 'CONTROL: an agent that did not mark it stays busy');
  /* An agent whose name is "operator" marks it: that is an agent, not the person. */
  tasks.setBuilt(p.id, n, { by: 'operator' });
  const t = stored(p.id, n);
  assert.equal(t.builtByPerson === true, false, 'an agent named operator was recorded as the person');
  assert.equal(t.builtFreesAll === true, false, 'an agent named operator freed everyone');
  assert.equal(tasks.setBuilt(p.id, n, { by: 'rex', refusePersonMark: true }).ok, true, 'an agent named operator locked the mark as the person\'s');
  /* CONTROL: the person's own mark does lock it, and frees everyone. */
  tasks.setBuilt(p.id, n, { person: true });
  assert.equal(tasks.setBuilt(p.id, n, { by: 'rex', refusePersonMark: true }).person, true);
  assert.equal(tasks.clearBuilt(p.id, n, { by: 'rex', refusePersonMark: true }).person, true);
  assert.equal(assigner.hasOpenWork('operator', read()), false);
});
