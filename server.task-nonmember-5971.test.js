'use strict';
/**
 * kosmos#5971: giving a task to an agent who is not on the task's project, through the routes the agent CLI uses
 * (`kosmos task add --who`, `kosmos task assign`), says so and gives it to nobody; a member is unaffected.
 *
 * Measured before this test: the engine already refuses both (engine/tasks.js create and assignPart), and the route
 * answers 400 with the engine's sentence. What was missing is a test through the routes with the REAL engine:
 * server.task-who-4887.test.js stubs tasks.create, so a regression that let a non-member through would pass it.
 * Every refusal arm has its member control, and the refusals check that nothing was written.
 *
 *   node --test server.task-nonmember-5971.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-nonmember-5971-'));
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
let board;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  board = fleet.install([fleet.agent('member', { state: 'idle' }), fleet.agent('outsider', { state: 'idle' })]);
});
test.after(() => {
  try { board.restore(); } catch { /* restored */ }
  try { server.close(); } catch { /* closed */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const SCREEN = { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
async function post(p, body) {
  const res = await fetch(base + p, { method: 'POST', headers: SCREEN, body: JSON.stringify(body) });
  return { code: res.status, json: await res.json().catch(() => null) };
}
function project() {
  const p = projects.create({ name: 'nonmember ' + Math.random().toString(36).slice(2, 8) });
  projects.addAgent(p.id, 'member', null);
  return p;
}
const stored = (id) => projects.readAll().find((x) => x && x.id === id);

test('#5971 task add --who a non-member is refused, says so, and makes nothing; a member is given it (control)', async () => {
  const p = project();
  const refused = await post(`/api/project/${p.id}/tasks`, { sentence: 'for someone outside', who: 'outsider' });
  assert.equal(refused.code, 400, JSON.stringify(refused.json));
  assert.match(refused.json.error, /that agent is not on this project, so the task cannot be given to it/);
  assert.equal((stored(p.id).tasks || []).length, 0, 'a task was made for a non-member');
  const given = await post(`/api/project/${p.id}/tasks`, { sentence: 'for the member', who: 'member' });
  assert.equal(given.code, 200, JSON.stringify(given.json));
  const t = (stored(p.id).tasks || []).find((x) => x.sentence === 'for the member');
  assert.ok(t, 'the member task was not made');
  assert.deepEqual(tasks.whoOf(t), ['member']);
});

test('#5971 task assign to a non-member is refused, says so, and leaves the owner as it was; a member is (control)', async () => {
  const p = project();
  const made = await post(`/api/project/${p.id}/tasks`, { sentence: 'to move' });
  assert.equal(made.code, 200, JSON.stringify(made.json));
  const n = (stored(p.id).tasks || [])[0].number;
  const refused = await post(`/api/project/${p.id}/task/${n}/assign`, { who: 'outsider' });
  assert.equal(refused.code, 400, JSON.stringify(refused.json));
  assert.match(refused.json.error, /not on this project/);
  assert.deepEqual(tasks.whoOf(tasks.byNumber(stored(p.id), n)), [], 'the task moved to a non-member');
  const moved = await post(`/api/project/${p.id}/task/${n}/assign`, { who: 'member' });
  assert.equal(moved.code, 200, JSON.stringify(moved.json));
  assert.deepEqual(tasks.whoOf(tasks.byNumber(stored(p.id), n)), ['member']);
});
