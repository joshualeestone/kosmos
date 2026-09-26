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
  tasks.setBuilt(id, n, { by: 'operator' });
  const t = stored(id, n);
  assert.equal(t.builtBy, 'operator');
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
  tasks.setBuilt(id, n, { by: 'operator' });
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
