'use strict';

/**
 * kosmos#7514: closing a parent closes its built subtasks; the board says which, and both commands (Mac install/kosmos,
 * Windows tools/windows/kosmos-cli.js) print them. Harness copied from cli.task-close-many-7412.test.js.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test cli.task-close-parent-7514.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-closeparent-cli-'));
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
const taskchat = require('./engine/taskchat');
const sendertoken = require('./engine/sendertoken');
const fleet = require('./test-support/fleet');
const cli = require('./tools/windows/kosmos-cli');

let base;
let projectId;
let board;
test.before(async () => {
  board = fleet.install([fleet.agent('mara', { state: 'idle' }), fleet.agent('otto', { state: 'idle' }), fleet.agent('kai', { state: 'idle' })]);
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  projectId = projects.create({ name: "CloseParent" }).id;
  projects.mutate(projectId, (p) => ({ ...p, agents: ['mara', 'otto'] }));   // kai is NOT on it
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  try { board.restore(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const taskOf = (n) => tasks.byNumber(projects.readAll().find((p) => p.id === projectId), n);
const isDone = (n) => tasks.progressOf(taskOf(n)).closed;
const token = (name) => sendertoken.mint(name).token;

async function win(argv, agentToken = null) {
  const out = []; const err = [];
  const code = await cli.main(argv, {
    env: {}, url: base,
    hook: { resolveUrl: () => base, readBoardToken: () => null, agentToken: () => agentToken },
    out: (s) => out.push(s), err: (s) => err.push(s),
  });
  return { code, text: out.concat(err).join('\n') };
}
const MAC_HOME = path.join(SANDBOX, 'kosmos-home');
fs.mkdirSync(path.join(MAC_HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(MAC_HOME, 'runtime', 'bin', 'node'));
function mac(args, agentToken = '', port = server.address().port) {
  const env = { ...process.env, KOSMOS_HOME: MAC_HOME, KOSMOS_PORT: String(port), TMUX_PANE: '', KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_AGENT_TOKEN: agentToken };
  return new Promise((resolve, reject) => {
    execFile(path.join(__dirname, 'install', 'kosmos'), args, { env, timeout: 45000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code: ' + (stderr || err.signal))); return; }
      resolve({ code: err ? err.code : 0, text: (stdout || '') + (stderr || '') });
    });
  });
}
const BOTH = [['Windows', win], ['Mac', mac]];


function round(label) {
  const top = tasks.create(projectId, { sentence: label + ' round' });
  const kid = tasks.create(projectId, { sentence: label + ' seat one', parent: top.number, who: 'mara' });
  const open = tasks.create(projectId, { sentence: label + ' seat two', parent: top.number, who: 'otto' });
  assert.equal(tasks.setBuilt(projectId, kid.number, { by: 'mara' }).ok, true);
  return { top: top.number, kid: kid.number, open: open.number };
}

test('kosmos#7514: the close route answers which built subtasks closed with the parent', async () => {
  const r = round('Route');
  const res = await fetch(`${base}/api/project/${projectId}/task/${r.top}/close`, { method: 'POST' });
  const j = await res.json();
  assert.equal(res.status, 200, JSON.stringify(j));
  assert.deepEqual(j.task.closedWith, [r.kid]);
  assert.equal(isDone(r.kid), true);
  assert.equal(isDone(r.open), false, 'an open subtask was closed');
});

test('kosmos#7514: the bulk close route says closedWith on the parent, and counts the subtask once if listed too', async () => {
  const r = round('Bulk');
  const res = await fetch(`${base}/api/tasks/close`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ tasks: [{ projectId, number: r.top }, { projectId, number: r.kid }] }) });
  const j = await res.json();
  assert.equal(res.status, 200, JSON.stringify(j));
  const parentRow = j.results.find((x) => x.number === r.top);
  assert.deepEqual(parentRow.closedWith, [r.kid]);
  const kidRow = j.results.find((x) => x.number === r.kid);
  assert.equal(kidRow.already, true, 'the subtask closed with its parent was closed a second time');
  assert.equal(isDone(r.open), false);
});

test('kosmos#7514: the Windows command says which built subtasks closed with it, single and several', async () => {
  const a = round('WinOne');
  const one = await win(['task', 'close', projectId, String(a.top)]);
  assert.equal(one.code, 0, one.text);
  assert.match(one.text, new RegExp('Closed task ' + a.top + ' on '));
  assert.match(one.text, new RegExp('Its built subtasks closed with it: ' + a.kid + '\\.'));
  const b = round('WinMany');
  const c = round('WinMany2');
  const many = await win(['task', 'close', projectId, String(b.top), String(c.open)]);
  assert.equal(many.code, 0, many.text);
  assert.match(many.text, new RegExp('Task ' + b.top + "'s built subtasks closed with it: " + b.kid + '\\.'));
  const plain = round('WinPlain');
  const p = await win(['task', 'close', projectId, String(plain.open)]);
  assert.doesNotMatch(p.text, /closed with it/, 'a task with no built subtasks said some closed with it');
});

test('kosmos#7514: the Mac command says which built subtasks closed with it, single and several', async () => {
  const a = round('MacOne');
  const one = await mac(['task', 'close', projectId, String(a.top)]);
  assert.equal(one.code, 0, one.text);
  assert.match(one.text, new RegExp('Closed task ' + a.top + ' on '));
  assert.match(one.text, new RegExp('Its built subtasks closed with it: ' + a.kid + '\\.'));
  const b = round('MacMany');
  const c = round('MacMany2');
  const many = await mac(['task', 'close', projectId, String(b.top), String(c.open)]);
  assert.equal(many.code, 0, many.text);
  assert.match(many.text, new RegExp('Task ' + b.top + "'s built subtasks closed with it: " + b.kid + '\\.'));
  const plain = round('MacPlain');
  const p = await mac(['task', 'close', projectId, String(plain.open)]);
  assert.doesNotMatch(p.text, /closed with it/, 'a task with no built subtasks said some closed with it');
});
