'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#9217 slice 1: `kosmos heavy start/end` (POST /api/heavy) and the board's status (heavyJobs). Over HTTP on a
 * sandboxed board: an agent records and ends only its own heavy job, a page request is refused, a bad label is refused
 * in the engine's words, and /api/status and GET /api/heavy list what is running.
 *
 *   node --test server.heavy-9217.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-heavy-9217-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server, boardAuthState } = require('./server');
const store = require('./engine/store');
const sendertoken = require('./engine/sendertoken');
const fleet = require('./test-support/fleet');

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
});
test.after(() => { try { fleet.restore(); } catch { /* best effort */ } try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const post = (body, headers) => fetch(`${base}/api/heavy`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const asAgent = (token, body) => post(body, { 'x-kosmos-agent-token': token });
const asScreen = (body) => post(body, { 'sec-fetch-site': 'same-origin' });
const jobsInStatus = async () => (await (await fetch(`${base}/api/status`)).json()).heavyJobs;

function twoAgents() {
  const board = fleet.install([fleet.agent('hv-ada', { state: 'idle' }), fleet.agent('hv-bo', { state: 'idle' })]);
  const name = (p) => (board.agents.find((c) => (c.sessionName || '').startsWith(p)) || {}).sessionName;
  return { board, ada: name('hv-ada'), bo: name('hv-bo') };
}

test('kosmos#9217: an agent records its heavy job, the status lists it with its name, and end clears it', async () => {
  const { ada } = twoAgents();
  assert.ok(ada, 'the fleet gave no cards');
  const tok = sendertoken.mint(ada).token;
  assert.deepEqual(await jobsInStatus(), [], 'control: nothing is listed before the call');
  let r = await asAgent(tok, { action: 'start', label: '  full   test run ', name: 'someone-else' });
  assert.equal(r.status, 200, await r.clone().text());
  const started = await r.json();
  assert.equal(started.ok, true);
  assert.equal(started.job.label, 'full test run');
  const listed = await jobsInStatus();
  assert.deepEqual(listed.map((j) => [j.agent, j.label, j.pid]), [[ada, 'full test run', null]], 'a name in the body is not read');
  const got = await (await fetch(`${base}/api/heavy`, { headers: { 'x-kosmos-agent-token': tok } })).json();
  assert.deepEqual(got.jobs.map((j) => j.label), ['full test run'], 'GET /api/heavy lists the same');
  r = await asAgent(tok, { action: 'end' });
  assert.deepEqual(await r.json(), { ok: true, ended: 1 });
  assert.deepEqual(await jobsInStatus(), []);
});

test('kosmos#9217: one agent cannot end another agent\'s job', async () => {
  const { ada, bo } = twoAgents();
  const ta = sendertoken.mint(ada).token, tb = sendertoken.mint(bo).token;
  assert.equal((await asAgent(ta, { action: 'start', label: 'ada job' })).status, 200);
  assert.deepEqual(await (await asAgent(tb, { action: 'end' })).json(), { ok: true, ended: 0 });
  assert.deepEqual((await jobsInStatus()).map((j) => j.agent), [ada]);
  await asAgent(ta, { action: 'end' });
});

test('kosmos#9217: a job tied to a process that has exited is not listed', async () => {
  const { ada } = twoAgents();
  const tok = sendertoken.mint(ada).token;
  const r = await asAgent(tok, { action: 'start', label: 'tied', pid: process.pid });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await jobsInStatus()).length, 1, 'control: this live process keeps it');
  const child = require('node:child_process').spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  const dead = Number(child.stdout);
  const refused = await asAgent(tok, { action: 'start', label: 'gone', pid: dead });
  assert.equal(refused.status, 400, 'a process that does not exist is refused at start');
  assert.match((await refused.json()).error, /there is no process/);
  await asAgent(tok, { action: 'end', pid: process.pid });
});

test('kosmos#9217: a page request, a bad action and a bad label are refused, and nothing is recorded', async () => {
  const { ada } = twoAgents();
  const tok = sendertoken.mint(ada).token;
  assert.equal((await asScreen({ action: 'start', label: 'x' })).status, 403);
  let r = await asAgent(tok, { action: 'begin', label: 'x' });
  assert.deepEqual([r.status, (await r.json()).error], [400, 'say start or end']);
  r = await asAgent(tok, { action: 'start', label: '-x' });
  assert.deepEqual([r.status, (await r.json()).error], [400, 'a job cannot start with -']);
  assert.deepEqual(await jobsInStatus(), []);
});
