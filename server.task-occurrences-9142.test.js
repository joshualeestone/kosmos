'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)

/**
 * kosmos#9142: GET /api/project/:id/task/:n/activity answers a repeating task's occurrences (one row per run or miss),
 * for the page and, with ?words=1, for the CLIs. A task that does not repeat answers as before (no field).
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE, as server.task-message-768.test.js.
 *
 *   node --test server.task-occurrences-9142.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-occ9142-'));
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
const fleet = require('./test-support/fleet');

let base;
let projectId;
let repeating;
let plain;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const roster = fleet.install([fleet.agent('mona', { state: 'idle' })]).agents;
  const a = projects.create({ name: 'Occ' });
  projects.addAgent(a.id, 'mona', roster);
  projectId = a.id;
  repeating = tasks.create(a.id, { sentence: 'Check the logs', who: 'mona' }, roster).number;
  plain = tasks.create(a.id, { sentence: 'Write the copy', who: 'mona' }, roster).number;
  tasks.setRepeat(a.id, repeating, { every: 'hour' }, { person: true });
  tasks.recordRun(a.id, repeating, 'mona', 'all clear');
});
test.after(() => new Promise((r) => server.close(r)));

const get = async (n, q = '') => {
  const res = await fetch(`${base}/api/project/${encodeURIComponent(projectId)}/task/${n}/activity${q}`);
  return { status: res.status, body: await res.json() };
};

test('a repeating task answers its occurrences: the run it just recorded is a delivered row', async () => {
  const { status, body } = await get(repeating);
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.occurrences) && body.occurrences.length >= 1, 'no occurrences: ' + JSON.stringify(body).slice(0, 300));
  const row = body.occurrences.find((r) => r.kind === 'delivered');
  assert.ok(row, 'no delivered row');
  assert.equal(row.by, 'mona');
  assert.equal(typeof row.at, 'string');
});

test('the CLIs\' ?words=1 answer carries the same occurrences', async () => {
  const { status, body } = await get(repeating, '?words=1');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.occurrences) && body.occurrences.some((r) => r.kind === 'delivered'));
});

test('CONTROL: a task that does not repeat answers as before, with no occurrences field', async () => {
  for (const q of ['', '?words=1']) {
    const { status, body } = await get(plain, q);
    assert.equal(status, 200);
    assert.equal('occurrences' in body, false, 'occurrences on a task that does not repeat (' + (q || 'page') + ')');
  }
});
