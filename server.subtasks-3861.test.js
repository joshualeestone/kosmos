'use strict';

/**
 * #3861: subtasks over HTTP and from both `kosmos` commands. The engine rules (no loops, no
 * cross-project parent, no cascading close) are proven in engine/tasks.subtasks-3861.test.js;
 * this proves the surfaces carry them: POST /api/project/:id/tasks takes `parent`, POST
 * .../task/:n/parent sets and clears it and refuses with a 400 that stored nothing, GET
 * /api/tasks rows say parent/parentSentence/subtasks, and `kosmos task add ... --parent <n>`
 * (Mac install/kosmos and Windows tools/windows/kosmos-cli.js) sends it.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test server.subtasks-3861.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-subsrv-'));
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
const cli = require('./tools/windows/kosmos-cli');

let base;
let projectId;
let top;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  projectId = projects.create({ name: 'Alpha' }).id;
  top = tasks.create(projectId, { sentence: 'The whole launch' }).number;
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const post = async (p, body) => {
  const res = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const rows = async () => (await (await fetch(`${base}/api/tasks?project=${encodeURIComponent(projectId)}`)).json()).tasks;
const row = async (n) => (await rows()).find((t) => t.number === n);

test('create with a parent makes a subtask; the rows say parent, its sentence, and the count', async () => {
  const w = await post(`/api/project/${projectId}/tasks`, { sentence: 'Write the copy', parent: top });
  assert.equal(w.status, 200);
  assert.equal(w.json.task.parent, top);
  const kid = await row(w.json.task.number);
  assert.equal(kid.parent, top);
  assert.equal(kid.parentSentence, 'The whole launch');
  const parent = await row(top);
  assert.ok(parent.subtasks.total >= 1, 'the parent row has no subtask count');
});

test('create with a parent that is not a task here is a 400 and makes nothing', async () => {
  const before = (await rows()).length;
  const w = await post(`/api/project/${projectId}/tasks`, { sentence: 'Orphan', parent: 999 });
  assert.equal(w.status, 400);
  assert.match(w.json.error, /no task 999 on this project/);
  assert.equal((await rows()).length, before, 'a refused create still made a task');
});

test('POST .../parent sets, clears, and refuses a loop with a 400 that changed nothing', async () => {
  const a = (await post(`/api/project/${projectId}/tasks`, { sentence: 'A' })).json.task.number;
  const b = (await post(`/api/project/${projectId}/tasks`, { sentence: 'B', parent: a })).json.task.number;
  const loop = await post(`/api/project/${projectId}/task/${a}/parent`, { parent: b });
  assert.equal(loop.status, 400);
  assert.match(loop.json.error, /already under this task/);
  assert.equal((await row(a)).parent, null, 'a refused loop was stored');
  const set = await post(`/api/project/${projectId}/task/${a}/parent`, { parent: top });
  assert.equal(set.status, 200);
  assert.equal((await row(a)).parent, top);
  const cleared = await post(`/api/project/${projectId}/task/${a}/parent`, { parent: null });
  assert.equal(cleared.status, 200);
  assert.equal((await row(a)).parent, null);
});

test('POST .../parent with no parent key is a 400; on a missing task a 404', async () => {
  assert.equal((await post(`/api/project/${projectId}/task/${top}/parent`, {})).status, 400);
  assert.equal((await post(`/api/project/${projectId}/task/9999/parent`, { parent: top })).status, 404);
  assert.equal((await post('/api/project/no-such-project/task/1/parent', { parent: null })).status, 404);
});

// ── Windows: tools/windows/kosmos-cli.js ────────────────────────────────────
async function win(argv) {
  const out = []; const err = [];
  const code = await cli.main(argv, {
    env: {}, url: base,
    hook: { resolveUrl: () => base, readBoardToken: () => null, agentToken: () => null },
    out: (s) => out.push(s), err: (s) => err.push(s),
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('Windows `task add ... --parent <n>` makes a subtask; the flag is not folded into the detail', async () => {
  const r = await win(['task', 'add', projectId, 'Pick the date', 'more', '--parent', String(top), 'words']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, new RegExp('under task ' + top));
  const made = (await rows()).find((t) => t.sentence === 'Pick the date');
  assert.equal(made.parent, top);
  assert.equal(made.detail, 'more words', 'the flag leaked into the detail, or the detail lost a word');
});

test('Windows `task add` refuses a bad --parent before reaching the board, and a refused parent exits 1', async () => {
  assert.equal((await win(['task', 'add', projectId, 'x', '--parent'])).code, 2);
  assert.equal((await win(['task', 'add', projectId, 'x', '--parent', 'two'])).code, 2);
  assert.equal((await win(['task', 'add', projectId, '--parent', '3'])).code, 2);
  assert.equal((await win(['task', 'add', projectId, '--parent=3'])).code, 2, 'a sentence of --parent=3 is refused, as the Mac CLI does (review iteration 3)');
  assert.equal((await win(['task', 'add', projectId, 'x', '--parent=3'])).code, 2, '--parent=3 must be refused, never folded into the detail');
  const r = await win(['task', 'add', projectId, 'x', '--parent', '999']);
  assert.equal(r.code, 1);
  assert.match(r.err, /no task 999/);
});

test('Windows `task list` shows the parent and the subtask count', async () => {
  const r = await win(['task', 'list', projectId]);
  assert.equal(r.code, 0);
  assert.match(r.out, new RegExp('\\(under task ' + top + '\\)'));
  assert.match(r.out, /\[\d+\/\d+ subtasks done\]/);
});

// ── Mac: install/kosmos (bash 3.2) ─────────────────────────────────────────
/* A KOSMOS_HOME whose runtime/bin/node is this node, as on an installed Mac: without it
   `task list` prints its raw-JSON fallback and the rendering under test never runs. */
const MAC_HOME = path.join(SANDBOX, 'kosmos-home');
fs.mkdirSync(path.join(MAC_HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(MAC_HOME, 'runtime', 'bin', 'node'));
function mac(args) {
  const env = { ...process.env, KOSMOS_HOME: MAC_HOME, KOSMOS_PORT: String(server.address().port), TMUX_PANE: '', KOSMOS_NO_LEGACY_MIGRATION: '1' };
  return new Promise((resolve, reject) => {
    execFile(path.join(__dirname, 'install', 'kosmos'), args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code: ' + (stderr || err.signal))); return; }
      resolve({ code: err ? err.code : 0, out: (stdout || '') + (stderr || '') });
    });
  });
}

test('Mac `task add ... --parent <n>` makes a subtask, a leading-zero number included', async () => {
  const r = await mac(['task', 'add', projectId, 'Book the room', 'some', '--parent', '00' + top, 'detail']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, new RegExp('under task ' + top + '\\.'), 'the leading zeros should be gone, as on Windows');
  const made = (await rows()).find((t) => t.sentence === 'Book the room');
  assert.ok(made, 'the task was not made: ' + r.out);
  assert.equal(made.parent, top);
  assert.equal(made.detail, 'some detail');
});

test('Mac `task add` refuses a bad --parent before the board, and a refused parent exits 1', async () => {
  assert.equal((await mac(['task', 'add', projectId, 'x', '--parent'])).code, 2);
  assert.equal((await mac(['task', 'add', projectId, 'x', '--parent', 'two'])).code, 2);
  assert.equal((await mac(['task', 'add', projectId, '--parent', '3'])).code, 2);
  assert.equal((await mac(['task', 'add', projectId, 'x', '--parent=3'])).code, 2, '--parent=3 must be refused, never folded into the detail');
  assert.equal((await mac(['task', 'add', projectId, 'x', '--parent', '0'])).code, 1, 'zero is sent and refused by the board');
  const r = await mac(['task', 'add', projectId, 'x', '--parent', '999']);
  assert.equal(r.code, 1);
  assert.match(r.out, /no task 999/);
});

test('Mac `task add` without --parent still makes a top-level task (control)', async () => {
  const r = await mac(['task', 'add', projectId, 'Loose one', 'plain', 'detail']);
  assert.equal(r.code, 0, r.out);
  const made = (await rows()).find((t) => t.sentence === 'Loose one');
  assert.equal(made.parent, null);
  assert.equal(made.detail, 'plain detail');
});

test('Mac `task list` shows the parent and the subtask count', async () => {
  const r = await mac(['task', 'list', projectId]);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /^\{"tasks"/, 'the list fell back to raw JSON, so the rendering was never run');
  assert.match(r.out, new RegExp('\\(under task ' + top + '\\)'));
  assert.match(r.out, /\[\d+\/\d+ subtasks done\]/);
});
