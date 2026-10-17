'use strict';

/**
 * #6330 slice 1: an agent's built mark (POST /api/project/:id/task/:n/built) tells the people the work is handed to, so
 * nobody polls for it: the task's other assignees and its parent task's assignees. Never the marker itself; never for a
 * clear, the same mark again, or the person's own mark from the screen. An assignee who left the project, or a swarm
 * switched off here, is not told, and the answer says so. The answer's `delivered` lists one outcome per agent.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test server.builttell-6330.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-builttell-'));
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

const post = async (p, body, headers = {}) => {
  const res = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const asAgent = (name) => {
  const m = sendertoken.mint(name);
  assert.equal(m.ok, true, m.because);
  return { 'x-kosmos-agent-token': m.token };
};
const mark = (n, as, body = {}) => post(`/api/project/${projectId}/task/${n}/built`, body, as);
const told = (r) => (r.json.delivered || []).map((d) => d.agent).sort();

test('the other assignees are told; the marker is not', async () => {
  const n = tasks.create(projectId, { sentence: 'Ship the invite page', who: 'mona' }).number;
  tasks.addPart(projectId, n, { sentence: 'Write the copy', who: 'zed' });
  const r = await mark(n, asAgent('mona'), { note: 'merged, waiting on the release' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(told(r), ['zed'], JSON.stringify(r.json));
  /* The sandbox runs without permission to touch agents, so every send answers could_not; what is proven here is that
     zed was ATTEMPTED (no filter's reason), as the #768 task-message test proves it. */
  const zed = r.json.delivered.find((d) => d.agent === 'zed');
  assert.doesNotMatch(String(zed.because), /not on this project|switched off/, 'zed was filtered: ' + JSON.stringify(zed));
});

test('the parent task holder is told too, once even when also on the task', async () => {
  const parent = tasks.create(projectId, { sentence: 'Launch the invite flow', who: 'ivy' }).number;
  const child = tasks.create(projectId, { sentence: 'Build the invite form', who: 'mona', parent }).number;
  const r = await mark(child, asAgent('mona'));
  assert.deepEqual(told(r), ['ivy'], JSON.stringify(r.json));
  // ivy on the child as well: still one line, not two.
  const both = tasks.create(projectId, { sentence: 'Test the invite form', who: 'mona', parent }).number;
  tasks.addPart(projectId, both, { sentence: 'Review it', who: 'ivy' });
  const r2 = await mark(both, asAgent('mona'));
  assert.deepEqual(told(r2), ['ivy'], JSON.stringify(r2.json));
});

test('a closed parent is nobody\'s to hand to', async () => {
  const parent = tasks.create(projectId, { sentence: 'Old launch', who: 'ivy' }).number;
  const child = tasks.create(projectId, { sentence: 'A late piece', who: 'mona', parent }).number;
  tasks.close(projectId, parent);
  const r = await mark(child, asAgent('mona'));
  assert.deepEqual(told(r), [], JSON.stringify(r.json));
});

test('nobody is told for the same mark again, a clear, or the person\'s own mark from the screen', async () => {
  const n = tasks.create(projectId, { sentence: 'Fix the footer', who: 'mona' }).number;
  tasks.addPart(projectId, n, { sentence: 'Check it on a phone', who: 'zed' });
  const first = await mark(n, asAgent('mona'), { note: 'done' });
  assert.deepEqual(told(first), ['zed'], 'control: the first mark tells zed: ' + JSON.stringify(first.json));
  const again = await mark(n, asAgent('mona'), { note: 'done' });
  assert.equal(again.status, 200);
  assert.equal(again.json.changed, false);
  assert.equal(again.json.delivered, undefined, 'the same mark again told someone: ' + JSON.stringify(again.json));
  const cleared = await mark(n, asAgent('mona'), { clear: true });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.json));
  assert.equal(cleared.json.delivered, undefined, 'a clear told someone: ' + JSON.stringify(cleared.json));
  const screen = await mark(n, { 'sec-fetch-site': 'same-origin' });
  assert.equal(screen.status, 200, JSON.stringify(screen.json));
  assert.equal(screen.json.delivered, undefined, 'the person\'s mark told someone: ' + JSON.stringify(screen.json));
});

test('an assignee who left the project is not told, and the answer says why', async () => {
  const roster = fleet.install([
    fleet.agent('mona', { state: 'idle' }), fleet.agent('zed', { state: 'idle' }), fleet.agent('ivy', { state: 'idle' }),
    fleet.agent('gone', { state: 'idle' }),
  ]).agents;
  projects.addAgent(projectId, 'gone', roster);
  const n = tasks.create(projectId, { sentence: 'Tidy the logs', who: 'mona' }).number;
  tasks.addPart(projectId, n, { sentence: 'Archive them', who: 'gone' });
  tasks.addPart(projectId, n, { sentence: 'Check the dashboards', who: 'zed' });
  projects.removeAgent(projectId, 'gone');
  const r = await mark(n, asAgent('mona'));
  assert.deepEqual(told(r), ['gone', 'zed'], JSON.stringify(r.json));
  const gone = r.json.delivered.find((d) => d.agent === 'gone');
  assert.equal(gone.state, 'could_not');
  assert.match(gone.because, /not on this project any more/);
  // CONTROL: the member on the same task was attempted, not filtered, so the filter is per agent.
  assert.doesNotMatch(String(r.json.delivered.find((d) => d.agent === 'zed').because), /not on this project/, JSON.stringify(r.json));
});

/* The typed text, as server.test.js pastedMessages reads it: set-buffer chunks up to each Enter. */
function pastedMessages(calls) {
  const msgs = [];
  let cur = '';
  let has = false;
  for (const a of calls) {
    if (a[0] === 'set-buffer') { cur += a[a.length - 1]; has = true; }
    else if (a[0] === 'send-keys' && a[a.length - 1] === 'Enter' && has) { msgs.push(cur); cur = ''; has = false; }
  }
  if (has) msgs.push(cur);
  return msgs;
}

test('the typed line says who marked which task built, the note, how to reply, and the parent it sits under', async () => {
  const chat = require('./engine/chat');
  const sends = [];
  try {
    chat.setRunner((args) => {
      sends.push(args);
      if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
      return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
    });
    chat.setDryRun(false);
    const parent = tasks.create(projectId, { sentence: 'Launch the shop', who: 'ivy' }).number;
    const n = tasks.create(projectId, { sentence: 'Build the cart', who: 'mona', parent }).number;
    tasks.addPart(projectId, n, { sentence: 'Price the items', who: 'zed' });
    const r = await mark(n, asAgent('mona'), { note: 'cart works, needs the price list' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(told(r), ['ivy', 'zed'], JSON.stringify(r.json));
    for (const d of r.json.delivered) assert.equal(d.state, 'placed', 'not typed: ' + JSON.stringify(d));
    const typed = pastedMessages(sends);
    const toZed = typed.find((t) => !/under your task/.test(t));
    const toIvy = typed.find((t) => /under your task/.test(t));
    assert.ok(toZed && toIvy, 'expected one line for each: ' + JSON.stringify(typed));
    assert.match(toZed, new RegExp(`mona marked task ${n} built: "cart works, needs the price list"`));
    assert.match(toZed, new RegExp(`reply in the task: kosmos task message ${projectId} ${n} "\\.\\.\\."`));
    assert.match(toIvy, new RegExp(`\\(it is under your task ${parent}\\)`), 'the parent holder is told why it hears this');
    assert.equal(typed.length, 2, 'exactly one line each for ivy and zed, none for mona: ' + JSON.stringify(typed));
  } finally {
    chat.resetForTests();
  }
});

test('alone on a task with no parent: an empty list, nothing sent', async () => {
  const n = tasks.create(projectId, { sentence: 'Rename a file', who: 'mona' }).number;
  const r = await mark(n, asAgent('mona'));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.delivered, [], JSON.stringify(r.json));
});
