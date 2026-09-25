'use strict';

/**
 * #3559, Josh's ruling (relayed by Splinter, 2026-09-25): the top-level Tasks tab appears only once
 * the person has 25 tasks. Counted: every task ever created, open and closed. Once shown it stays
 * shown (a saved flag). 25 is one constant (tasks.TASKS_TAB_MIN).
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test server.tasks-tab-gate-3559.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-tasksgate-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const projects = require('./engine/projects');
const tasks = require('./engine/tasks');
const store = require('./engine/store');

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { try { server.close(); } catch { /* closed */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const statusTab = async () => (await (await fetch(`${base}/api/status`)).json()).tasksTab;

test('the count is every task ever created: open, closed and archived count; the constant is 25', () => {
  assert.equal(tasks.TASKS_TAB_MIN, 25);
  const fake = [
    { taskCounter: 10, tasks: [{}, {}] },               // counter wins: numbers are never reused
    { taskCounter: 0, tasks: [{}, {}, {}] },             // a project written before the counter: its list is the floor
    { archived: true, taskCounter: 4, tasks: [] },       // archived still counts
    null,
  ];
  assert.equal(tasks.tasksEverCreated(fake), 17);
  assert.equal(tasks.tasksEverCreated(null), 0);
});

test('below 25 the tab stays hidden; the 25th task shows it; it stays shown after the count falls', async () => {
  assert.notEqual(store.readSettings().tasksTabShown, true, 'the sandbox starts with the flag set (control)');
  const a = projects.create({ name: 'Gate A' });
  for (let i = 0; i < 20; i++) tasks.create(a.id, { sentence: 'open ' + i });
  const b = projects.create({ name: 'Gate B' });
  for (let i = 0; i < 4; i++) tasks.create(b.id, { sentence: 'b ' + i });
  tasks.close(b.id, 1);
  assert.equal(tasks.tasksEverCreated(projects.readAll()) >= 24, true);
  assert.equal(await statusTab(), false, 'the tab shows at 24 tasks');
  assert.notEqual(store.readSettings().tasksTabShown, true, 'the flag was saved before 25');
  tasks.create(b.id, { sentence: 'the twenty-fifth' });
  assert.equal(await statusTab(), true, 'the tab does not show at 25 tasks (a closed one included)');
  assert.equal(store.readSettings().tasksTabShown, true, 'reaching 25 did not save the flag');
  // Once shown it stays shown: remove the projects the count came from; the flag holds.
  projects.remove(a.id);
  projects.remove(b.id);
  assert.ok(tasks.tasksEverCreated(projects.readAll()) < 25, 'the fixture did not drop the count (control)');
  assert.equal(await statusTab(), true, 'the tab went away again after it had been shown');
});
