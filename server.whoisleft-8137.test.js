'use strict';
/**
 * kosmos#8137: the real routes. POST .../built says who else is still to finish, and /api/tasks and /api/projects carry
 * whoIsLeft. Stored project records hold agent NAMES while projects.get() holds member OBJECTS, and only a real route can
 * show which one a rule was given: an earlier version got the objects and silently filtered everyone out.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test server.whoisleft-8137.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-whoisleft-'));
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
const sendertoken = require('./engine/sendertoken');

let base;
let projectId;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const roster = fleet.install([
    fleet.agent('mona', { state: 'idle' }), fleet.agent('zed', { state: 'idle' }), fleet.agent('ivy', { state: 'idle' }),
  ]).agents;
  const p = projects.create({ name: 'Alpha' });
  for (const a of ['mona', 'zed', 'ivy']) projects.addAgent(p.id, a, roster);
  projectId = p.id;
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const asAgent = (name) => {
  const m = sendertoken.mint(name);
  assert.equal(m.ok, true, m.because);
  return { 'x-kosmos-agent-token': m.token };
};
const mark = async (n, headers, body = {}) => {
  const res = await fetch(`${base}/api/project/${projectId}/task/${n}/built`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
};
const two = (sentence) => {
  const n = tasks.create(projectId, { sentence, who: 'mona' }).number;
  tasks.addPart(projectId, n, { sentence: 'The second half', who: 'zed' });
  return n;
};
const row = async (n) => (await (await fetch(`${base}/api/tasks?project=${projectId}`)).json()).tasks.find((t) => t.number === n);
const pageTask = async (n) => {
  const all = await (await fetch(`${base}/api/projects`)).json();
  return all.projects.find((p) => p.id === projectId).tasks.find((t) => t.number === n);
};

test('an agent marking its part built is told who else is left, by the real route', async () => {
  const n = two('Spring catalogue');
  const r = await mark(n, asAgent('mona'), { note: 'my half' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.stillToFinish, 'Still to finish: zed.');
  const keys = Object.keys(r.json);
  assert.ok(keys.includes('summary'), 'premise: this mark told someone: ' + JSON.stringify(keys));
  assert.equal(keys[keys.length - 1], 'summary', 'the CLI reads summary as the last key');
  assert.ok(keys.indexOf('stillToFinish') < keys.indexOf('summary'));
});

test('the last to mark is told nothing, and neither is a checker with no part', async () => {
  const n = two('Autumn catalogue');
  assert.equal((await mark(n, asAgent('ivy'), { note: 'checked' })).json.stillToFinish, undefined, 'a checker holds no part');
  assert.equal((await mark(n, asAgent('mona'), { note: 'my half' })).json.stillToFinish, 'Still to finish: zed.', 'control: an assignee is told');
  assert.equal((await mark(n, asAgent('zed'), { note: 'my half' })).json.stillToFinish, undefined, 'nobody left');
});

test('a mark from the screen is the person\'s: it frees everyone, so it says nothing', async () => {
  const n = two('Winter catalogue');
  const r = await mark(n, {}, { note: 'all done' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.stillToFinish, undefined);
});

test('a task with one agent is told nothing', async () => {
  const n = tasks.create(projectId, { sentence: 'One agent', who: 'mona' }).number;
  assert.equal((await mark(n, asAgent('mona'), { note: 'done' })).json.stillToFinish, undefined);
});

test('/api/tasks and /api/projects both carry it, the same, on a several-agent task only', async () => {
  const n = two('Summer catalogue');
  await mark(n, asAgent('mona'), { note: 'my half' });
  const want = { finished: ['mona'], left: ['zed'] };
  assert.deepEqual((await row(n)).whoIsLeft, want, 'the Tasks tab, the iPhone rows and the CLI lists read this');
  assert.deepEqual((await pageTask(n)).whoIsLeft, want, 'the task pages read this');
  const one = tasks.create(projectId, { sentence: 'Just one', who: 'mona' }).number;
  assert.equal('whoIsLeft' in (await row(one)), false, 'control');
  assert.equal('whoIsLeft' in (await pageTask(one)), false, 'control');
});
