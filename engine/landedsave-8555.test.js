'use strict';

/**
 * kosmos#8555: the Tasks view's check of a task's commit (engine/landedcheck.js) used to be read on /api/tasks only,
 * within 14 days of a close, and kept nowhere. So a task closed on a note whose commit was pushed later read "with a
 * change" on the Tasks row and "on a note" on the task page, and "on a note" everywhere again after two weeks. Now:
 *   - tasks.saveOnRemote keeps a remote's copy on the task (only upward, only for the commit checked, written once);
 *   - a re-mark of the same commit keeps it (an agent whose checkout had not fetched says "not on the remote");
 *   - landedcheck.cachedFor hands a synchronous reader the check's cached answer, never a new git call;
 *   - the task page's payload (projects.joinTaskClaims) carries that answer for a closed task, within the window.
 *
 * SANDBOX THE ROOTS BEFORE REQUIRING anything that reads them.
 *
 *   node --test engine/landedsave-8555.test.js
 */
require('../test-support/tmpscope');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-landedsave-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-landedsave-proj-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('../engine/projects');
const tasks = require('../engine/tasks');
const landedcheck = require('../engine/landedcheck');

const SHA = 'a'.repeat(40);
const OTHER = 'c'.repeat(40);
const REPO = path.join(os.tmpdir(), 'some-repo', '.git');

function freshTask() {
  const p = projects.create({ name: 'Landed save ' + Math.random().toString(36).slice(2), agents: ['rex'] });
  return { id: p.id, n: tasks.create(p.id, { sentence: 'Fix the thing', who: 'rex' }).number };
}
const project = (id) => projects.readAll().find((x) => x.id === id);
const stored = (id, n) => tasks.byNumber(project(id), n);
const mark = (id, n, onRemote, sha = SHA) => {
  const r = tasks.setBuilt(id, n, { by: 'rex', note: 'fixed', commit: { sha, repo: REPO, onRemote } });
  assert.equal(r.ok, true, JSON.stringify(r));
};
/* The task page's rows, as the project payload builds them (a closed task needs no roster). */
const pageRow = (id, n) => {
  const p = project(id);
  return projects.joinTaskClaims(p.tasks, projects.readAll(), p.agents, null, { name: p.name, id: p.id }).find((t) => t.number === n);
};
/* A git that answers as a repository with the commit, and a remote that has it or not; or one without the commit. */
const gitWith = ({ has = true, onRemote = true } = {}) => async (args) => {
  if (args.includes('cat-file')) { if (has) return ''; const e = new Error('no such object'); e.code = 1; throw e; }
  if (args.includes('for-each-ref')) return onRemote ? 'refs/remotes/origin/main\n' : '';
  return '.git\n';
};
const check = (t, opts) => landedcheck.checkTask(t, { exists: () => true, budget: { left: 10 }, ...opts });

test.beforeEach(() => landedcheck.resetForTests());

test('saveOnRemote keeps a remote copy on a task closed on a note, so it reads with a change from the store', () => {
  const { id, n } = freshTask();
  mark(id, n, false);
  tasks.close(id, n);
  assert.equal(tasks.closedHowOf(stored(id, n)), 'note', 'CONTROL: a commit only here closed it on a note');
  assert.deepEqual(tasks.saveOnRemote(id, n, SHA, REPO), { ok: true, changed: true });
  assert.equal(stored(id, n).landedOnRemote, true);
  assert.equal(stored(id, n).closedHow, 'note', 'the word kept at the close was rewritten (closedHowOf derives the upgrade)');
  assert.equal(tasks.closedHowOf(stored(id, n)), 'change', 'the saved upgrade did not reach the word');
  assert.equal(pageRow(id, n).closedHow, 'change', 'the task page still read on a note');
});

test('past the check window the saved upgrade still reads with a change (the check no longer runs then)', () => {
  const { id, n } = freshTask();
  const { id: id2, n: n2 } = freshTask();
  for (const [a, b] of [[id, n], [id2, n2]]) { mark(a, b, false); tasks.close(a, b); }
  tasks.saveOnRemote(id, n, SHA, REPO);
  const old = new Date(Date.now() - landedcheck.CHECK_WINDOW_MS - 60 * 1000).toISOString();
  for (const a of [id, id2]) projects.mutate(a, (p) => ({ ...p, tasks: p.tasks.map((t) => ({ ...t, closedAt: old })) }));
  assert.equal(tasks.closedHowOf(stored(id, n)), 'change', 'the upgrade was lost past the window');
  assert.equal(tasks.closedHowOf(stored(id2, n2)), 'note', 'CONTROL: the same task never upgraded still reads on a note');
});

test('saveOnRemote writes once, only for the commit checked, and never downward', () => {
  const { id, n } = freshTask();
  mark(id, n, false);
  assert.deepEqual(tasks.saveOnRemote(id, n, OTHER, REPO), { ok: true, changed: false }, 'another commit (a new mark since the check) was upgraded');
  assert.equal(stored(id, n).landedOnRemote, false, 'CONTROL: still as marked');
  assert.deepEqual(tasks.saveOnRemote(id, n, SHA, path.join(os.tmpdir(), 'another-repo', '.git')), { ok: true, changed: false },
    'the same sha in another repository (a re-mark since the check) was upgraded from a check of the old one');
  assert.equal(tasks.saveOnRemote(id, n, SHA).ok, false, 'a save with no repository was accepted');
  assert.equal(tasks.saveOnRemote(id, n, SHA, REPO).changed, true, 'an open task is upgraded too (its commit line reads the same field)');
  const at = project(id).updatedAt;
  assert.deepEqual(tasks.saveOnRemote(id, n, SHA, REPO), { ok: true, changed: false }, 'a task that already says so was written again');
  assert.equal(project(id).updatedAt, at, 'the store was rewritten for nothing');
  assert.equal(tasks.saveOnRemote(id, 999, SHA, REPO).changed, false, 'no such task');
  assert.equal(tasks.saveOnRemote(id, n, 'not-a-sha', REPO).ok, false, 'a bad sha was accepted');
  assert.equal(tasks.saveOnRemote('no-such-project', n, SHA, REPO).ok, false, 'a missing project read as a clean no-op');
});

test('a reopen drops the commit, so a check that finished after it saves nothing', () => {
  const { id, n } = freshTask();
  mark(id, n, false);
  tasks.close(id, n);
  tasks.reopen(id, n);
  assert.equal(stored(id, n).landedCommit, undefined, 'PRE-CONTROL: a reopen drops the commit (#7508)');
  assert.equal(tasks.saveOnRemote(id, n, SHA, REPO).changed, false, 'a reopened task was given the old commit\'s remote copy');
  assert.equal(stored(id, n).landedOnRemote, undefined);
});

test('a re-mark of the same commit that says not on the remote keeps the saved copy; a new commit does not', () => {
  const { id, n } = freshTask();
  mark(id, n, false);
  tasks.saveOnRemote(id, n, SHA, REPO);
  mark(id, n, false);
  assert.equal(stored(id, n).landedOnRemote, true, 'a re-mark from a checkout that had not fetched undid the board\'s check');
  mark(id, n, false, OTHER);
  assert.equal(stored(id, n).landedOnRemote, false, 'CONTROL: a different commit says what its own mark says');
});

test('cachedFor answers from the cache only: nothing before a check, the answer after, nothing once it expires', async () => {
  const t = { landedCommit: SHA, landedRepo: REPO };
  assert.equal(landedcheck.cachedFor(t), null, 'an answer before any check');
  let calls = 0;
  const counting = gitWith({ has: false });
  assert.equal((await check(t, { git: async (a) => { calls += 1; return counting(a); } })).state, 'missing');
  const before = calls;
  assert.deepEqual(landedcheck.cachedFor(t), { state: 'missing' });
  assert.equal(calls, before, 'cachedFor ran git');
  assert.equal(landedcheck.cachedFor(t, { now: () => Date.now() + landedcheck.TTL_MS + 1 }), null, 'an expired answer');
  assert.equal(landedcheck.cachedFor({ landedCommit: OTHER, landedRepo: REPO }), null, 'another commit\'s answer');
  assert.equal(landedcheck.cachedFor({}), null);
});

test('the task page carries the check\'s cached answer for a closed task, and leaves the word out where it is missing', async () => {
  const { id, n } = freshTask();
  mark(id, n, true);
  tasks.close(id, n);
  assert.equal(pageRow(id, n).landedCheck, undefined, 'CONTROL: no check has run, so the page has no answer');
  assert.equal(pageRow(id, n).closedHow, 'change', 'PRE-CONTROL: closed on a pushed commit');
  await check(stored(id, n), { git: gitWith({ has: false }) });
  assert.equal(pageRow(id, n).landedCheck, 'missing', 'the task page did not get the check\'s answer');
  assert.equal(pageRow(id, n).landedRepo, undefined, 'the page row carried the repository path');
});

test('the task page carries no check for an open task, nor for one closed before the window', async () => {
  const open = freshTask();
  mark(open.id, open.n, true);
  await check(stored(open.id, open.n), { git: gitWith({ has: false }) });
  assert.equal(pageRow(open.id, open.n).landedCheck, undefined, 'an open task carried a closed task\'s check');
  const old = freshTask();
  mark(old.id, old.n, true, OTHER);
  tasks.close(old.id, old.n);
  const longAgo = new Date(Date.now() - landedcheck.CHECK_WINDOW_MS - 60 * 1000).toISOString();
  projects.mutate(old.id, (p) => ({ ...p, tasks: p.tasks.map((t) => ({ ...t, closedAt: longAgo })) }));
  await check(stored(old.id, old.n), { git: gitWith({ has: false }) });
  assert.equal(pageRow(old.id, old.n).landedCheck, undefined, 'a task closed past the window carried a check git may have cleaned away');
});
