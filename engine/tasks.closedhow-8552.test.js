'use strict';

/**
 * kosmos#8552: a closed task says how it closed (closedHow): with a change, on a note, or never marked built. DERIVED from
 * the marks the task carries as it closes, never asked for, and kept on the task because closing drops the built mark.
 *
 * SANDBOX BOTH ROOTS BEFORE REQUIRING anything that reads them.
 *
 *   node --test engine/tasks.closedhow-8552.test.js
 */
require('../test-support/tmpscope');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-closedhow-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-closedhow-proj-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('../engine/projects');
const tasks = require('../engine/tasks');
const tasklist = require('../engine/tasklist');

const SHA = 'a'.repeat(40);
const REPO = path.join(os.tmpdir(), 'some-repo');
const PRINT = 'sha256:' + 'b'.repeat(64);

function freshTask(who = 'rex') {
  const p = projects.create({ name: 'Closed how ' + Math.random().toString(36).slice(2), agents: ['rex', 'ivy'] });
  const made = tasks.create(p.id, { sentence: 'Ship the thing', who });
  return { id: p.id, n: made.number };
}
const stored = (id, n) => tasks.byNumber(projects.readAll().find((x) => x.id === id), n);
const row = (id, n) => tasks.allTasks().find((t) => t.projectId === id && t.number === n);
const mark = (id, n, extra) => { const r = tasks.setBuilt(id, n, { by: 'rex', ...extra }); assert.equal(r.ok, true, JSON.stringify(r)); };

test('a commit that is on a remote closes it with a change', () => {
  const { id, n } = freshTask();
  mark(id, n, { note: 'fixed', commit: { sha: SHA, repo: REPO, onRemote: true } });
  tasks.close(id, n);
  assert.equal(stored(id, n).closedHow, 'change');
  assert.equal(tasks.closedHowOf(stored(id, n)), 'change');
  assert.equal(row(id, n).closedHow, 'change', 'the task list row carries the engine word');
});

test('a commit only on this computer is not a change: built with neither reads on a note', () => {
  const { id, n } = freshTask();
  mark(id, n, { note: 'fixed', commit: { sha: SHA, repo: REPO, onRemote: false } });
  tasks.close(id, n);
  assert.equal(stored(id, n).closedHow, 'note');
});

test('a delivered file fingerprint closes it with a change', () => {
  const { id, n } = freshTask();
  mark(id, n, { fingerprint: PRINT });
  tasks.close(id, n);
  assert.equal(stored(id, n).closedHow, 'change');
});

test('built with only words closes it on a note', () => {
  const { id, n } = freshTask();
  mark(id, n, { note: 'I looked and it is fine' });
  tasks.close(id, n);
  const t = stored(id, n);
  assert.equal(t.closedHow, 'note');
  assert.equal('builtAt' in t, false, 'control: closing still drops the built mark, which is why the word is kept');
});

test('closed with no built mark reads without being marked built', () => {
  const { id, n } = freshTask();
  tasks.close(id, n);
  assert.equal(stored(id, n).closedHow, 'unbuilt');
});

test('a re-close keeps the word from the first close (the built mark is already gone)', () => {
  const { id, n } = freshTask();
  mark(id, n, { fingerprint: PRINT });
  tasks.close(id, n);
  tasks.close(id, n);
  assert.equal(stored(id, n).closedHow, 'change');
});

test('a reopen clears it, and the next close derives it again', () => {
  const { id, n } = freshTask();
  mark(id, n, { fingerprint: PRINT });
  tasks.close(id, n);
  tasks.reopen(id, n, { by: 'rex' });
  assert.equal('closedHow' in stored(id, n), false);
  assert.equal(tasks.closedHowOf(stored(id, n)), null, 'an open task has no word');
  tasks.close(id, n);
  assert.equal(stored(id, n).closedHow, 'unbuilt', 'the reopen was new work: nothing marked it built since');
});

test('replaced and not-run closes keep their own words: closedHowOf says nothing for them', () => {
  const a = freshTask();
  const other = tasks.create(a.id, { sentence: 'The replacement', who: 'rex' });
  tasks.close(a.id, a.n, { replacedBy: other.number });
  assert.equal(tasks.closedHowOf(stored(a.id, a.n)), null);
  assert.equal(row(a.id, a.n).closedHow, null);
  const b = freshTask();
  tasks.close(b.id, b.n, { notRun: true });
  assert.equal(tasks.closedHowOf(stored(b.id, b.n)), null);
});

test('a task its last part closed is derived the same way, before its built mark goes', () => {
  const { id, n } = freshTask();
  const second = tasks.addPart(id, n, { sentence: 'the other half', who: 'ivy' });
  assert.ok(second && second.ok !== false, JSON.stringify(second));
  mark(id, n, { note: 'only words' });
  const parts = tasks.partsOf(stored(id, n));
  assert.equal(parts.length, 2);
  tasks.setPartClosed(id, n, parts[0].id, new Date().toISOString());
  assert.equal('closedHow' in stored(id, n), false, 'control: one part open is not closed');
  tasks.setPartClosed(id, n, parts[1].id, new Date().toISOString());
  assert.equal(stored(id, n).closedHow, 'note');
  tasks.setPartClosed(id, n, parts[1].id, null);
  assert.equal('closedHow' in stored(id, n), false, 'a part put back clears it');
});

test('a task closed before this was recorded: a commit on a remote still reads, nothing else is guessed', () => {
  assert.equal(tasks.closedHowOf({ closedAt: '2026-11-01T00:00:00Z', landedCommit: SHA, landedOnRemote: true }), 'change');
  assert.equal(tasks.closedHowOf({ closedAt: '2026-11-01T00:00:00Z', landedCommit: SHA, landedOnRemote: false }), null);
  assert.equal(tasks.closedHowOf({ closedAt: '2026-11-01T00:00:00Z' }), null);
  assert.equal(tasks.closedHowOf({ closedAt: '2026-11-01T00:00:00Z', closedHow: 'made-up' }), null, 'an unknown stored word is not shown');
  assert.equal(tasks.closedHowOf({ closedAt: '2026-11-01T00:00:00Z', replacedBy: 3, closedHow: 'unbuilt' }), null, 'replaced before kosmos#8301 kept no closedUnrun: still its own word');
  assert.equal(tasks.closedHowOf({ closedAt: '2026-11-01T00:00:00Z', closedHow: 'unbuilt' }), 'unbuilt', 'control: the same row unreplaced reads');
});

test('closedHowAt reads every arm, each from its own field', () => {
  assert.equal(tasks.closedHowAt({}), 'unbuilt');
  assert.equal(tasks.closedHowAt({ builtAt: 'x' }), 'note');
  assert.equal(tasks.closedHowAt({ builtAt: 'x', builtFingerprint: PRINT }), 'change');
  assert.equal(tasks.closedHowAt({ builtAt: 'x', builtFilePath: '/a/b' }), 'change');
  assert.equal(tasks.closedHowAt({ builtAt: 'x', landedCommit: SHA, landedOnRemote: true }), 'change');
  assert.equal(tasks.closedHowAt({ builtAt: 'x', landedCommit: SHA, landedOnRemote: 'true' }), 'note', 'only a real true');
  assert.equal(tasks.closedHowAt({ builtAt: '', builtFingerprint: PRINT }), 'unbuilt', 'no built mark, no delivered file');
});

test('the CLI state words say it after done, and nothing for a board that sends none', () => {
  const words = (x) => tasklist.showLines({ tasks: [{ number: 1, sentence: 'T', isClosed: true, ...x }] }, 1, 'P').lines.find((l) => l.startsWith('State: '));
  assert.equal(words({ closedHow: 'change' }), 'State: done, with a change');
  assert.equal(words({ closedHow: 'note' }), 'State: done, on a note');
  assert.equal(words({ closedHow: 'unbuilt' }), 'State: done, without being marked built');
  assert.equal(words({}), 'State: done');
  assert.equal(words({ closedHow: 'change', closedUnrun: true }), 'State: closed, not run');
});

test('the task page read (joinTaskClaims) carries the same engine word as the task list', () => {
  const { id, n } = freshTask();
  mark(id, n, { fingerprint: PRINT });
  tasks.close(id, n);
  const rec = projects.readAll().find((x) => x.id === id);
  const joined = projects.joinTaskClaims(rec.tasks, projects.readAll(), [], [], { name: rec.name, id: rec.id });
  assert.equal(joined.find((t) => t.number === n).closedHow, 'change');
  const open = tasks.create(id, { sentence: 'still open', who: 'rex' });
  const again = projects.joinTaskClaims(projects.readAll().find((x) => x.id === id).tasks, projects.readAll(), [], [], { name: rec.name, id: rec.id });
  assert.equal(again.find((t) => t.number === open.number).closedHow, null, 'CONTROL: an open task has none');
});

test('a parent whose subtasks did the work is not called unbuilt (kosmos#8301: its work is on its children)', () => {
  const { id, n } = freshTask();
  const kid = tasks.create(id, { sentence: 'the piece', who: 'rex', parent: n });
  assert.equal(tasks.byNumber(projects.readAll().find((x) => x.id === id), kid.number).parent, n, 'PRE-CONTROL: the child is stored under the parent');
  tasks.setBuilt(id, kid.number, { by: 'rex', fingerprint: PRINT });
  tasks.close(id, n);
  assert.equal('closedHow' in stored(id, n), false);
  assert.equal(tasks.closedHowOf(stored(id, n)), null);
  const other = freshTask();
  tasks.create(other.id, { sentence: 'its piece', who: 'rex', parent: other.n });
  mark(other.id, other.n, { fingerprint: PRINT });
  tasks.close(other.id, other.n);
  assert.equal(stored(other.id, other.n).closedHow, 'change', 'a parent with its own delivered file still reads with a change');
  const leaf = freshTask();
  tasks.close(leaf.id, leaf.n);
  assert.equal(stored(leaf.id, leaf.n).closedHow, 'unbuilt', 'CONTROL: the same close with no subtasks is unbuilt');
});

test('a parent closed by its last part, with subtasks, is not called unbuilt either', () => {
  const { id, n } = freshTask();
  tasks.create(id, { sentence: 'the piece', who: 'rex', parent: n });
  const parts = tasks.partsOf(stored(id, n));
  assert.equal(parts.length, 1);
  tasks.setPartClosed(id, n, parts[0].id, new Date().toISOString());
  assert.equal(tasks.progressOf(stored(id, n)).closed, true, 'PRE-CONTROL: closed by its part');
  assert.equal('closedHow' in stored(id, n), false);
});

test('a note whose commit reached a remote after the close reads with a change', () => {
  assert.equal(tasks.closedHowOf({ closedAt: 'x', closedHow: 'note', landedCommit: SHA, landedOnRemote: true }), 'change');
  assert.equal(tasks.closedHowOf({ closedAt: 'x', closedHow: 'note', landedCommit: SHA, landedOnRemote: false }), 'note', 'CONTROL: still local');
  assert.equal(tasks.closedHowOf({ closedAt: 'x', closedHow: 'unbuilt', landedCommit: SHA, landedOnRemote: true }), 'unbuilt', 'only a note is upgraded');
});

test('the CLI leaves the word out where the board cannot find the change, as the page does', () => {
  const words = (x) => tasklist.showLines({ tasks: [{ number: 1, sentence: 'T', isClosed: true, ...x }] }, 1, 'P').lines.find((l) => l.startsWith('State: '));
  assert.equal(words({ closedHow: 'change', landedCheck: 'missing' }), 'State: done');
  assert.equal(words({ closedHow: 'change', landedCheck: 'kept' }), 'State: done, with a change', 'CONTROL');
});

test('a subtask put under a task after it closed unbuilt takes the word away, on both reads', () => {
  const { id, n } = freshTask();
  tasks.close(id, n);
  assert.equal(row(id, n).closedHow, 'unbuilt', 'PRE-CONTROL');
  tasks.create(id, { sentence: 'added later', who: 'rex', parent: n });
  assert.equal(stored(id, n).closedHow, 'unbuilt', 'the stored word is unchanged');
  assert.equal(row(id, n).closedHow, null, 'the task list');
  const rec = projects.readAll().find((x) => x.id === id);
  const joined = projects.joinTaskClaims(rec.tasks, projects.readAll(), [], [], { name: rec.name, id: rec.id });
  assert.equal(joined.find((t) => t.number === n).closedHow, null, 'the task page');
  assert.equal(tasks.closedHowOf({ closedAt: 'x', closedHow: 'note' }, { hasSubtasks: true }), 'note', 'only unbuilt gives way');
});

test('built subtasks closed with their parent are each derived from their own mark', () => {
  const { id, n } = freshTask();
  const a = tasks.create(id, { sentence: 'a file', who: 'rex', parent: n });
  const b = tasks.create(id, { sentence: 'words', who: 'rex', parent: n });
  mark(id, a.number, { fingerprint: PRINT });
  mark(id, b.number, { note: 'done' });
  const out = tasks.close(id, n, { withBuilt: true });
  assert.deepEqual(out.closedWith.slice().sort((x, y) => x - y), [a.number, b.number].sort((x, y) => x - y), 'PRE-CONTROL: both closed with it');
  assert.equal(stored(id, a.number).closedHow, 'change');
  assert.equal(stored(id, b.number).closedHow, 'note');
});
