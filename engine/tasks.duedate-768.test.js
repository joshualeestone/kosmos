'use strict';

/**
 * #768: a task's due date. Josh's #768 body authorizes it ("if there's a due
 * date assigned"), reversing the earlier deliberate no-due-date deferral. The
 * engine stores a calendar date (YYYY-MM-DD) or null, validates it whole (a
 * nonsense date is refused, never stored), and records a lifecycle event so the
 * change shows in the task's activity (#992).
 *
 * ⚠️ SANDBOX BOTH ROOTS BEFORE REQUIRING anything that reads them.
 *
 *   node --test engine/tasks.duedate-768.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-due-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-due-proj-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('../engine/projects');
const tasks = require('../engine/tasks');
const taskchat = require('../engine/taskchat');

function freshTask() {
  const p = projects.create({ name: 'Due ' + Math.random().toString(36).slice(2) });
  const made = tasks.create(p.id, { sentence: 'Ship it' });
  return { id: p.id, n: made.number, made };
}

test('a new task is born with dueDate null (the field always exists)', () => {
  const { made } = freshTask();
  assert.equal(made.dueDate, null, 'a fresh task should carry an explicit null dueDate, not undefined');
  assert.ok('dueDate' in made, 'the field must be present so no consumer has to guess');
});

test('setDue stores a valid calendar date and reads it back', () => {
  const { id, n } = freshTask();
  const t = tasks.setDue(id, n, '2026-12-25');
  assert.equal(t.dueDate, '2026-12-25');
  assert.equal(tasks.byNumber(projects.readAll().find((x) => x.id === id), n).dueDate, '2026-12-25',
    'the stored task did not keep the due date');
});

test('setDue with null or empty string clears the date', () => {
  const { id, n } = freshTask();
  tasks.setDue(id, n, '2026-12-25');
  assert.equal(tasks.setDue(id, n, null).dueDate, null, 'null did not clear the date');
  tasks.setDue(id, n, '2026-12-25');
  assert.equal(tasks.setDue(id, n, '').dueDate, null, 'empty string did not clear the date');
});

test('setDue REFUSES a malformed or impossible date, and stores nothing (the dangerous-answer control)', () => {
  const { id, n } = freshTask();
  tasks.setDue(id, n, '2026-01-10');   // a known-good baseline
  for (const bad of ['not-a-date', '2026/12/25', '12-25-2026', '2026-13-01', '2026-02-31', '2026-2-5', 5, {}]) {
    assert.throws(() => tasks.setDue(id, n, bad), /due date|real date/, `a bad value '${JSON.stringify(bad)}' was accepted`);
  }
  // the refused writes did not disturb the good value
  assert.equal(tasks.byNumber(projects.readAll().find((x) => x.id === id), n).dueDate, '2026-01-10',
    'a refused setDue changed the stored date');
});

test('dueProblem is the shared validator: null/valid pass, nonsense fails', () => {
  assert.equal(tasks.dueProblem(null), null);
  assert.equal(tasks.dueProblem(''), null);
  assert.equal(tasks.dueProblem('2026-06-15'), null);
  assert.ok(tasks.dueProblem('2026-02-31'), 'an impossible date should be rejected');
  assert.ok(tasks.dueProblem('nope'), 'a non-date should be rejected');
});

test('setDue records a lifecycle event so the change shows in the task activity', () => {
  const { id, n } = freshTask();
  tasks.setDue(id, n, '2026-09-30');
  tasks.setDue(id, n, null);
  const kinds = taskchat.read(id, n).map((e) => e.kind);
  assert.ok(kinds.includes('due-set'), 'setting a due date recorded no due-set event');
  assert.ok(kinds.includes('due-cleared'), 'clearing a due date recorded no due-cleared event');
  const set = taskchat.read(id, n).find((e) => e.kind === 'due-set');
  assert.equal(set.dueDate, '2026-09-30', 'the due-set event lost the date it carried');
});

test('setDue is no-op-safe: setting the same value again records nothing new', () => {
  const { id, n } = freshTask();
  tasks.setDue(id, n, '2026-09-30');
  const before = taskchat.read(id, n).filter((e) => e.kind === 'due-set').length;
  tasks.setDue(id, n, '2026-09-30');   // same value again
  const after = taskchat.read(id, n).filter((e) => e.kind === 'due-set').length;
  assert.equal(after, before, 'setting the same due date logged a duplicate event');
});
