'use strict';

/**
 * POST /api/project/:id/task/:n/due (#768): set or clear a task's due date.
 * The engine validation is covered by engine/tasks.duedate-768.test.js; this
 * proves the HTTP surface sets a valid date, clears on null, and refuses a
 * nonsense date with a 400 (never a 200 that pretends it saved).
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test server.task-duedate-768.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-duesrv-'));
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

let base, projectId, taskNum;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const a = projects.create({ name: 'Alpha' });
  const made = tasks.create(a.id, { sentence: 'Write the copy' });
  projectId = a.id;
  taskNum = made.number;
});

const setDue = async (id, n, body) => {
  const res = await fetch(`${base}/api/project/${encodeURIComponent(id)}/task/${n}/due`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const getDue = async (id, n) => {
  const body = await (await fetch(`${base}/api/tasks`)).json();
  const t = body.tasks.find((x) => x.projectId === id && x.number === n);
  return t ? t.dueDate : undefined;
};

test('POST due with a valid date sets it, and it reads back', async () => {
  const w = await setDue(projectId, taskNum, { dueDate: '2026-12-25' });
  assert.equal(w.status, 200);
  assert.equal(w.json.task.dueDate, '2026-12-25');
  assert.equal(await getDue(projectId, taskNum), '2026-12-25', 'the stored task lost the due date');
});

test('POST due with null clears it', async () => {
  await setDue(projectId, taskNum, { dueDate: '2026-12-25' });
  const w = await setDue(projectId, taskNum, { dueDate: null });
  assert.equal(w.status, 200);
  assert.equal(w.json.task.dueDate, null);
  assert.equal(await getDue(projectId, taskNum), null, 'the date was not cleared');
});

test('POST due with a nonsense date is a 400 and stores nothing (dangerous-answer control)', async () => {
  await setDue(projectId, taskNum, { dueDate: '2026-01-10' }); // known-good baseline
  const w = await setDue(projectId, taskNum, { dueDate: '2026-02-31' });
  assert.equal(w.status, 400, 'an impossible date must be refused, never a 200');
  assert.ok(w.json && w.json.error, 'a 400 should name the problem');
  assert.equal(await getDue(projectId, taskNum), '2026-01-10', 'a refused date changed the stored value');
});

test('POST due to a missing task is a 404', async () => {
  const w = await setDue(projectId, 99999, { dueDate: '2026-06-15' });
  assert.equal(w.status, 404);
});

test.after(() => { try { server.close(); } catch { /* already down */ } });
