'use strict';
/**
 * #6923 (agent feedback 10-22): review-and-correct cycles leave built tasks a later task replaced, and they read as
 * work waiting for review. A close can now say which task replaced it: the task is closed, carries replacedBy, and its
 * history says replaced. Reopening clears the link; a later plain close of a replaced task keeps it.
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const nodePath = require('node:path');

process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-6923-'));
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-6923-data-'));
const projects = require('./projects');
const tasks = require('./tasks');
const taskchat = require('./taskchat');

const stored = (pid, n) => tasks.byNumber(projects.readAll().find((x) => x.id === pid), n);
const kinds = (pid, n) => taskchat.read(pid, n).map((r) => r.kind + (r.replacedBy ? ':' + r.replacedBy : ''));

function two(name) {
  const p = projects.create({ name });
  tasks.create(p.id, { sentence: 'First try' });
  tasks.create(p.id, { sentence: 'Second try' });
  return p.id;
}

test('#6923: closing with replacedBy closes the task and names what replaced it', () => {
  const pid = two('Replaced');
  const t = tasks.close(pid, 1, { replacedBy: 2 });
  assert.ok(t.closedAt, 'it is closed');
  assert.equal(t.replacedBy, 2);
  assert.equal(stored(pid, 1).replacedBy, 2, 'stored');
  assert.deepEqual(kinds(pid, 1).filter((k) => k.startsWith('closed')), ['closed:2'], 'the history says replaced by #2');
  assert.equal(stored(pid, 2).closedAt, null, 'the replacing task is untouched');
});

test('#6923: CONTROL, a plain close carries no link', () => {
  const pid = two('Plain');
  const t = tasks.close(pid, 1);
  assert.ok(t.closedAt);
  assert.equal('replacedBy' in t, false);
  assert.deepEqual(kinds(pid, 1).filter((k) => k.startsWith('closed')), ['closed']);
});

test('#6923: a task number from text is accepted; anything else is refused and writes nothing', () => {
  const pid = two('Numbers');
  assert.equal(tasks.close(pid, 1, { replacedBy: ' 2 ' }).replacedBy, 2, 'the CLI sends text');
  const pid2 = two('Refusals');
  for (const [bad, want] of [[true, /has to be a task number/], ['1e1', /has to be a task number/], [0, /has to be a task number/],
    [-2, /has to be a task number/], [2.5, /has to be a task number/], ['two', /has to be a task number/],
    [1, /cannot be replaced by itself/], [9, /no task 9 on this project/]]) {
    assert.throws(() => tasks.close(pid2, 1, { replacedBy: bad }), want, String(bad));
    assert.equal(stored(pid2, 1).closedAt, null, String(bad) + ': nothing was closed');
  }
});

test('#6923: reopening clears the link; a later plain close of a replaced task leaves it (so history and state agree)', () => {
  const pid = two('Reopen');
  tasks.close(pid, 1, { replacedBy: 2 });
  const back = tasks.reopen(pid, 1);
  assert.equal(back.closedAt, null);
  assert.equal('replacedBy' in stored(pid, 1), false, 'reopen clears it');
  tasks.close(pid, 1);
  assert.equal('replacedBy' in stored(pid, 1), false, 'CONTROL: closed plainly after the reopen, it is done');
  tasks.reopen(pid, 1);
  tasks.close(pid, 1, { replacedBy: 2 });
  tasks.close(pid, 1);
  assert.equal(stored(pid, 1).replacedBy, 2, 'a plain re-close does not quietly turn replaced into done');
});

test('#6923: two tasks cannot each be marked as replaced by the other', () => {
  const pid = two('Cycle');
  tasks.close(pid, 1, { replacedBy: 2 });
  assert.throws(() => tasks.close(pid, 2, { replacedBy: 1 }), /already marked as replaced by this one/);
  assert.equal(stored(pid, 2).closedAt, null, 'nothing was closed');
});

test('#6923: a longer loop is refused too, and a task can be pointed at a different replacement', () => {
  const pid = two('Loop');
  tasks.create(pid, { sentence: 'Third try' });
  tasks.close(pid, 1, { replacedBy: 2 });
  tasks.close(pid, 2, { replacedBy: 3 });
  assert.throws(() => tasks.close(pid, 3, { replacedBy: 1 }), /through other tasks/);
  assert.equal(stored(pid, 3).closedAt, null, 'nothing was closed');
  tasks.close(pid, 1, { replacedBy: 3 });   // re-pointed
  assert.equal(stored(pid, 1).replacedBy, 3);
  assert.deepEqual(kinds(pid, 1).filter((k) => k.startsWith('closed') || k.startsWith('replaced')), ['closed:2', 'replaced:3']);
});

test('#6923: a task already closed can be marked replaced afterwards, and the history says so once', () => {
  const pid = two('Later');
  tasks.close(pid, 1);
  const finished = '2026-01-02T03:04:05.000Z';   // an older finish, so a reset to now would show
  projects.mutate(pid, (p) => ({ ...p, tasks: p.tasks.map((t) => (t.number === 1 ? { ...t, closedAt: finished } : t)) }));
  tasks.close(pid, 1, { replacedBy: 2 });
  tasks.close(pid, 1, { replacedBy: 2 });   // the same again records nothing new
  assert.equal(stored(pid, 1).replacedBy, 2);
  assert.equal(stored(pid, 1).closedAt, finished, 'when it finished does not move');
  assert.deepEqual(kinds(pid, 1).filter((k) => k.startsWith('closed') || k.startsWith('replaced')), ['closed', 'replaced:2']);
});

test('#6923: closing a built task as replaced drops the built mark, so it no longer waits for review', () => {
  const pid = two('Built');
  tasks.setBuilt(pid, 1, { by: 'ada' });
  assert.ok(stored(pid, 1).builtAt, 'marked built first');
  tasks.close(pid, 1, { replacedBy: 2 });
  assert.ok(!stored(pid, 1).builtAt, 'the built mark is gone');
});

test('#6936: an open task never carries replacedBy, whatever closed and reopened it (the loop check relies on it)', () => {
  const pid = two('Invariant');
  tasks.create(pid, { sentence: 'Third try' });
  const openWithLink = () => projects.readAll().find((x) => x.id === pid).tasks.filter((t) => !t.closedAt && t.replacedBy !== undefined).map((t) => t.number);
  tasks.close(pid, 1, { replacedBy: 2 });
  tasks.reopen(pid, 1);
  assert.deepEqual(openWithLink(), [], 'after a reopen');
  tasks.close(pid, 1, { replacedBy: 3 });
  tasks.close(pid, 1);   // a plain re-close keeps the link on a CLOSED task
  assert.equal(stored(pid, 1).replacedBy, 3);
  tasks.reopen(pid, 1, { why: 'not replaced after all' });
  assert.deepEqual(openWithLink(), [], 'after a reopen with a reason');
  tasks.close(pid, 2, { replacedBy: 3 });
  tasks.reopen(pid, 2, { person: true });
  assert.deepEqual(openWithLink(), [], 'after a reopen by the person');
  // CONTROL: the probe sees a link where one is.
  tasks.close(pid, 1, { replacedBy: 2 });
  const closedWithLink = projects.readAll().find((x) => x.id === pid).tasks.filter((t) => t.closedAt && Number.isInteger(t.replacedBy)).map((t) => t.number);
  assert.deepEqual(closedWithLink, [1]);
});
