'use strict';
require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/* #5153 slice 4: the undo routes against the real server. Sandboxed as server.receipt-5153.test.js is.
 *   node --test server.undo-5153.test.js */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-undo-route-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SANDBOX, 'claude-projects');

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { server.closeAllConnections(); server.close(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const post = async (p, body) => {
  const res = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const put = async (p, body, headers = {}) => {
  const res = await fetch(base + p, { method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test('undo: off until the person turns it on; a kept copy undoes a closed task\'s edit; agents cannot undo or switch it', async () => {
  let r = await fetch(base + '/api/undo-setting');
  assert.deepEqual(await r.json(), { on: false, ok: true });
  assert.equal((await put('/api/undo-setting', { on: true }, { 'x-kosmos-agent-token': 'any' })).status, 403);
  assert.equal((await post('/api/undo/keep', { path: '/nowhere/x.md', cwd: '/nowhere' })).body.because, 'off', 'nothing kept while off');
  assert.deepEqual((await put('/api/undo-setting', { on: true })).body, { on: true, ok: true });

  const projects = require('./engine/projects');
  const taskchat = require('./engine/taskchat');
  const folder = path.join(process.env.AGENT_WORKFORCE_WORKERS, 'uri');
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(fs.realpathSync(folder), 'notes.md');
  fs.writeFileSync(file, 'ORIGINAL');
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  projects.writeAll([...projects.readAll(), { id: 'undo-p', name: 'Undo project', agents: ['uri'], tasks: [{ number: 1, sentence: 'Edit the notes', closedAt: iso(now + 60000) }] }]);
  const chat = taskchat.taskChatFile('undo-p', 1);
  fs.mkdirSync(path.dirname(chat), { recursive: true });
  fs.writeFileSync(chat, [{ at: iso(now - 60000), kind: 'created', who: 'uri' }, { at: iso(now + 60000), kind: 'closed' }].map((x) => JSON.stringify(x)).join('\n') + '\n');

  assert.equal((await post('/api/undo/keep', { path: file, cwd: fs.realpathSync(folder), session: 's' })).body.kept, true, 'the hook\'s call keeps a copy');
  fs.writeFileSync(file, 'THE AGENT\'S EDIT');

  const url = base + '/api/project/undo-p/task/1/undo';
  r = await fetch(url, { headers: { 'x-kosmos-agent-token': 'any' } });
  assert.equal(r.status, 403, 'an agent cannot see or undo a task');
  r = await fetch(url);
  const plan = await r.json();
  assert.deepEqual(plan.files.map((x) => [x.path, x.action, x.ok]), [[file, 'restore', true]]);
  const done = await post('/api/project/undo-p/task/1/undo', { paths: [file] });
  assert.deepEqual(done.body.done, [file]);
  assert.equal(fs.readFileSync(file, 'utf8'), 'ORIGINAL');

  await put('/api/undo-setting', { on: false });
  assert.equal((await post('/api/project/undo-p/task/1/undo', { paths: [file] })).status, 409, 'nothing is undone while the switch is off');
  assert.equal((await post('/api/project/undo-p/task/1/undo', { paths: 'x' })).status, 400);
  assert.equal((await fetch(base + '/api/project/undo-p/task/9/undo')).status, 404);
});

test('the real `kosmos keep-copy` reaches the board and a copy is kept, a name with a space and a quote included', async () => {
  await put('/api/undo-setting', { on: true });
  const folder = path.join(process.env.AGENT_WORKFORCE_WORKERS, 'vic');
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(fs.realpathSync(folder), 'odd "name" here.md');
  fs.writeFileSync(file, 'BEFORE');
  const copies = () => { const d = path.join(require('./engine/store').ROOT, 'undo', 'copies'); let n = 0;
    for (const k of fs.existsSync(d) ? fs.readdirSync(d) : []) n += fs.readdirSync(path.join(d, k)).filter((x) => x.endsWith('.json')).length; return n; };
  const before = copies();
  const { execFile } = require('node:child_process');
  const port = String(server.address().port);
  const code = await new Promise((resolve) => execFile('bash', [path.join(__dirname, 'install', 'kosmos'), 'keep-copy', file, fs.realpathSync(folder), 's-cli'],
    { env: { ...process.env, KOSMOS_PORT: port, KOSMOS_HOME: HOME, TMUX_PANE: '' }, timeout: 20000 }, (err) => resolve(err ? err.code : 0)));
  assert.equal(code, 0, 'keep-copy always exits 0');
  assert.equal(copies(), before + 1, 'no copy was kept through the CLI');
  const metas = [];
  const d = path.join(require('./engine/store').ROOT, 'undo', 'copies');
  for (const k of fs.readdirSync(d)) for (const n of fs.readdirSync(path.join(d, k))) if (n.endsWith('.json')) metas.push(JSON.parse(fs.readFileSync(path.join(d, k, n), 'utf8')));
  assert.ok(metas.some((m) => m.path === file && m.session === 's-cli' && m.existed), 'the path arrived whole');
});
