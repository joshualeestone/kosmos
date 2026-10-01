'use strict';

/**
 * #4914: POST /api/project/:id/task/:n/assign, behind `kosmos task assign <project> <n> <who> [--part <m>]`.
 * The board picks the part (the only one, or the one named, and lists them when there are several), resolves `who`
 * as `task add --who` does (me, names by key, nobody), and moves it through givePart. Real task engine and store;
 * a fleet of two (mara, otto) so agent tokens resolve.
 *
 *   node --test server.task-assign-4914.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskassign-4914-'));
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
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const projects = require('./engine/projects');
const tasks = require('./engine/tasks');
const sendertoken = require('./engine/sendertoken');
const fleet = require('./test-support/fleet');

let base;
let projectId;
let board;
test.before(async () => {
  board = fleet.install([fleet.agent('mara', { state: 'idle' }), fleet.agent('otto', { state: 'idle' })]);
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  projectId = projects.create({ name: 'Moves' }).id;
  projects.mutate(projectId, (p) => ({ ...p, agents: ['mara', 'otto'] }));
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  try { board.restore(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const asAgent = (name) => ({ 'x-kosmos-agent-token': sendertoken.mint(name).token });
async function assign(n, body, headers = {}) {
  const res = await fetch(`${base}/api/project/${encodeURIComponent(projectId)}/task/${n}/assign`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { code: res.status, json, text };
}
const ownerOf = (n) => tasks.whoOf(tasks.byNumber(projects.readAll().find((p) => p.id === projectId), n));
const fresh = (sentence, who) => tasks.create(projectId, { sentence, who }).number;

test('CONTROL: an agent moves a one-part task to another agent, who is told; the answer names the new owner', async () => {
  const n = fresh('Write the brief', 'mara');
  const r = await assign(n, { who: 'otto' }, asAgent('mara'));
  assert.equal(r.code, 200, r.text.slice(0, 200));
  assert.equal(r.json.who, 'otto');
  assert.equal(r.json.part, 1);
  assert.deepEqual(ownerOf(n), ['otto']);
  assert.ok(r.json.heard && r.json.heard.who === 'otto', 'otto was not paged about the task: ' + JSON.stringify(r.json.heard));
});

test('me is the calling agent, and an agent that takes a task is not paged about it', async () => {
  const n = fresh('Check the numbers', 'otto');
  const r = await assign(n, { who: 'me' }, asAgent('mara'));
  assert.equal(r.code, 200, r.text.slice(0, 200));
  assert.deepEqual(ownerOf(n), ['mara']);
  assert.equal(r.json.heard, undefined, 'the caller was paged about a task it took');
});

test('a name in another case finds the member; nobody takes the owner off', async () => {
  const n = fresh('Book the room', 'mara');
  assert.equal((await assign(n, { who: 'OTTO' }, asAgent('mara'))).code, 200);
  assert.deepEqual(ownerOf(n), ['otto']);
  const off = await assign(n, { who: 'nobody' }, asAgent('mara'));
  assert.equal(off.code, 200, off.text.slice(0, 200));
  assert.equal(off.json.who, null);
  assert.deepEqual(ownerOf(n), [], 'nobody did not take the owner off');
});

test('a task with several parts is not guessed at: the parts are listed; --part moves the one named', async () => {
  const n = fresh('Launch', 'mara');
  tasks.addPart(projectId, n, { sentence: 'Write the post', who: 'otto' });
  const r = await assign(n, { who: 'otto' }, asAgent('mara'));
  assert.equal(r.code, 400, r.text.slice(0, 200));
  assert.match(r.json.error, /has 2 parts: 1 Launch \(mara\); 2 Write the post \(otto\)\. Name one with --part <number>/);
  assert.deepEqual(ownerOf(n).sort(), ['mara', 'otto'], 'a refused move changed an owner');
  const two = await assign(n, { who: 'mara', part: 2 }, asAgent('mara'));
  assert.equal(two.code, 200, two.text.slice(0, 200));
  assert.equal(two.json.part, 2);
  assert.deepEqual(ownerOf(n), ['mara']);
});

test('refusals: a part that is not there, a task that is not there, no who, a non-member, an unnamed me', async () => {
  const n = fresh('Tidy up', 'mara');
  const badPart = await assign(n, { who: 'otto', part: 7 }, asAgent('mara'));
  assert.equal(badPart.code, 400); assert.match(badPart.json.error, /has no part 7/);
  assert.equal((await assign(9999, { who: 'otto' }, asAgent('mara'))).code, 404);
  const noWho = await assign(n, {}, asAgent('mara'));
  assert.equal(noWho.code, 400); assert.match(noWho.json.error, /say who the task goes to/);
  const zed = await assign(n, { who: 'zed' }, asAgent('mara'));
  assert.equal(zed.code, 400); assert.match(zed.json.error, /not on this project/);
  const unnamed = await assign(n, { who: 'me' });
  assert.equal(unnamed.code, 400); assert.match(unnamed.json.error, /could not tell which agent you are/);
  const blank = await assign(n, { who: ' ' }, asAgent('mara'));
  assert.equal(blank.code, 400); assert.match(blank.json.error, /not an agent's name/);
  assert.deepEqual(ownerOf(n), ['mara'], 'a refused move changed the owner');
});

test('an agent that is not on the project cannot move its tasks', async (t) => {
  const n = fresh('Not yours', 'mara');
  const outsider = fleet.install([fleet.agent('mara', { state: 'idle' }), fleet.agent('otto', { state: 'idle' }), fleet.agent('zed', { state: 'idle' })]);
  t.after(() => { outsider.restore(); board = fleet.install([fleet.agent('mara', { state: 'idle' }), fleet.agent('otto', { state: 'idle' })]); });
  const r = await assign(n, { who: 'otto' }, asAgent('zed'));
  assert.equal(r.code, 403, r.text.slice(0, 200));
  assert.match(r.json.error, /not on this project, so it cannot move its tasks/);
  assert.deepEqual(ownerOf(n), ['mara']);
});
