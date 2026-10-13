'use strict';
/* #3029: each Tasks row names its project's ancestors (projectPath, root first), so the Tasks screen can
 * label a subproject by its chain (Book A › Launch) the way the grid's ancestry line does.
 *
 *   node --test engine/tasks.projectpath-3029.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const nodePath = require('node:path');

process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-ppath-'));
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-ppath-data-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-ppath-workers-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-ppath-launch-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
const projects = require('./projects');
const tasks = require('./tasks');

const task = (n) => ({ number: n, sentence: 'task ' + n, createdAt: '2026-10-01T00:00:00Z', closedAt: null });
const pathOf = (rows, id) => rows.find((r) => r.projectId === id).projectPath;

test('projectPath: [] at the top, the chain root first below it, two same-named subprojects told apart', () => {
  const rows = tasks.allTasks([
    { id: 'a', name: 'Book A', tasks: [task(1)] },
    { id: 'b', name: 'Book B', tasks: [task(1)] },
    { id: 'la', name: 'Launch', parent: 'a', tasks: [task(1)] },
    { id: 'lb', name: 'Launch', parent: 'b', tasks: [task(1)] },
    { id: 'ad', name: 'Ads', parent: 'la', tasks: [task(1)] },
  ]);
  assert.deepEqual(pathOf(rows, 'a'), []);
  assert.deepEqual(pathOf(rows, 'la'), ['Book A']);
  assert.deepEqual(pathOf(rows, 'lb'), ['Book B']);
  assert.deepEqual(pathOf(rows, 'ad'), ['Book A', 'Launch']);
  /* Additive: the name a row already carried is untouched. */
  assert.equal(rows.find((r) => r.projectId === 'ad').projectName, 'Ads');
});

test('projectPath: a parent missing from the read stands in by its stored name, else nothing; a loop stops', () => {
  const rows = tasks.allTasks([
    { id: 'o', name: 'Orphan', parent: 'gone', parentName: 'Ghost Parent', tasks: [task(1)] },
    { id: 'n', name: 'Nameless orphan', parent: 'gone', tasks: [task(1)] },
    { id: 'x', name: 'X', parent: 'y', tasks: [task(1)] },
    { id: 'y', name: 'Y', parent: 'x', tasks: [task(1)] },
  ]);
  assert.deepEqual(pathOf(rows, 'o'), ['Ghost Parent']);
  assert.deepEqual(pathOf(rows, 'n'), []);
  assert.deepEqual(pathOf(rows, 'x'), ['Y'], 'a stored loop must stop, never hang or repeat');
});

test('projectPath on projects the app really writes: a subproject made with create({ parent })', () => {
  const top = projects.create({ name: 'Real Book' });
  const sub = projects.create({ name: 'Real Launch', parent: top.id });
  tasks.create(sub.id, { sentence: 'the launch post' });
  const rows = tasks.allTasks();
  const row = rows.find((r) => r.projectId === sub.id);
  assert.ok(row, 'the subproject task is a row');
  assert.deepEqual(row.projectPath, ['Real Book']);
});
