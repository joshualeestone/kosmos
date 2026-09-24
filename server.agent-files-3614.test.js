'use strict';
/* #3614 items 1, 2, 4: the agent page's Files routes, against a real sandboxed board.
 * GET /api/agent/:name/files, POST .../files/open, POST .../files/reveal. The opener is the
 * injected reveal runner, so nothing opens on this machine.
 *
 *   node --test server.agent-files-3614.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agentfiles-'));
process.env.HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
for (const d of ['data', 'projects', 'workers', 'launch']) fs.mkdirSync(path.join(SANDBOX, d), { recursive: true });

const { start, server } = require('./server');
const projects = require('./engine/projects');
const dmfiles = require('./engine/dmfiles');

let base;
const calls = [];
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  projects.setRevealRunner((file, args) => { calls.push([file, args]); return { ok: true }; });
  projects.setRevealPlatform('darwin');
});
test.after(() => {
  projects.setRevealPlatform(null);
  projects.setRevealRunner(null);
  try { server.close(); } catch { /* closed */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const agentDir = (name) => { const d = path.join(SANDBOX, 'workers', name); fs.mkdirSync(d, { recursive: true }); return d; };
const get = async (p) => { const r = await fetch(base + p); return { status: r.status, json: await r.json() }; };
const post = async (p, body, headers = {}) => {
  const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};

test('the folder is Renet\'s dmfiles.filesDir, and a Files folder that does not exist yet is the EMPTY state', async () => {
  agentDir('ana');
  assert.equal(dmfiles.filesDir('ana'), path.join(SANDBOX, 'workers', 'ana', 'Files'), 'fixture: the path is not <workerDir>/Files');
  const r = await get('/api/agent/ana/files');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true, 'a Files folder that is not there yet read as an error');
  assert.equal(r.json.missing, true);
  assert.deepEqual(r.json.files, []);
  assert.equal(fs.existsSync(dmfiles.filesDir('ana')), false, 'listing created the folder');
});

test('files the agent saved are listed newest first with name, size and date; dotfiles and folders are not', async () => {
  const dir = path.join(agentDir('ben'), 'Files');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'old.txt'), 'old');
  fs.utimesSync(path.join(dir, 'old.txt'), new Date('2026-01-01'), new Date('2026-01-01'));
  fs.writeFileSync(path.join(dir, 'report.pdf'), 'x'.repeat(2048));
  fs.writeFileSync(path.join(dir, '.hidden'), 'h');
  fs.mkdirSync(path.join(dir, 'sub'));
  const r = await get('/api/agent/ben/files');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.files.map((f) => f.name), ['report.pdf', 'old.txt']);
  assert.equal(r.json.files[0].size, 2048);
  assert.ok(Date.parse(r.json.files[0].modified) > Date.parse(r.json.files[1].modified));
  assert.equal(r.json.total, 2);
  assert.ok(typeof r.json.stamp === 'string' && r.json.stamp.length > 0);
});

test('an unknown agent is 404; a name that cannot be a folder is refused; the list is read-only', async () => {
  assert.equal((await get('/api/agent/nobody/files')).status, 404);
  assert.equal((await get('/api/agent/..%2F..%2Fetc/files')).status, 404, 'a traversal name reached a folder');
  assert.equal((await get('/api/agent/%E0%A4%A/files')).status, 400);
  agentDir('cal');
  assert.equal((await post('/api/agent/cal/files', {})).status, 405);
});

test('a Files that is a link to somewhere else is not listed, opened or revealed', async () => {
  const d = agentDir('dee');
  const outside = fs.mkdtempSync(path.join(SANDBOX, 'outside-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 's');
  fs.symlinkSync(outside, path.join(d, 'Files'));
  const r = await get('/api/agent/dee/files');
  assert.equal(r.json.ok, false);
  assert.deepEqual(r.json.files, [], 'a linked Files listed what it points at');
  const before = calls.length;
  assert.equal((await post('/api/agent/dee/files/open', { name: 'secret.txt' })).status, 409);
  assert.equal((await post('/api/agent/dee/files/reveal')).status, 409);
  assert.equal(calls.length, before, 'a linked Files reached the opener');
});

test('open: a real file opens once; a name escaping the folder is refused by the engine; another site is refused', async () => {
  const d = path.join(agentDir('eve'), 'Files');
  fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, 'notes.md'), 'n');
  fs.writeFileSync(path.join(agentDir('eve'), 'CLAUDE.md'), 'instructions');
  const before = calls.length;
  const cross = await post('/api/agent/eve/files/open', { name: 'notes.md' }, { origin: 'https://evil.example' });
  assert.equal(cross.status, 403, 'another website made this machine open a file');
  const esc = await post('/api/agent/eve/files/open', { name: '../CLAUDE.md' });
  assert.equal(esc.status, 409, 'a name outside the Files folder was opened');
  assert.equal(calls.length, before);
  const ok = await post('/api/agent/eve/files/open', { name: 'notes.md' });
  assert.equal(ok.status, 200, 'control: a real file did not open');
  assert.equal(calls.length, before + 1);
  assert.equal(calls[calls.length - 1][1][0], fs.realpathSync(path.join(d, 'notes.md')), 'the opener got a path other than the file (openFile passes the resolved path)');
});

test('reveal: creates the Files folder on first use, inside the agent\'s folder, then opens it; a file named Files is refused', async () => {
  agentDir('fay');
  const before = calls.length;
  const r = await post('/api/agent/fay/files/reveal');
  assert.equal(r.status, 200);
  assert.ok(fs.lstatSync(dmfiles.filesDir('fay')).isDirectory(), 'reveal did not create the folder');
  assert.equal(calls.length, before + 1);
  assert.equal(calls[calls.length - 1][1][0], dmfiles.filesDir('fay'));
  const g = await get('/api/agent/fay/files');
  assert.equal(g.json.ok, true);
  assert.equal(g.json.missing, undefined, 'the made folder still read as missing');
  // A plain file named Files is never replaced.
  fs.writeFileSync(path.join(agentDir('gus'), 'Files'), 'not a folder');
  const bad = await post('/api/agent/gus/files/reveal');
  assert.equal(bad.status, 409);
  assert.equal(fs.readFileSync(path.join(SANDBOX, 'workers', 'gus', 'Files'), 'utf8'), 'not a folder');
  assert.equal((await post('/api/agent/gus/files/reveal', {}, { origin: 'https://evil.example' })).status, 403);
});

test('a name store.safeKey changes (Writer) lists the SAME folder dmfiles.filesDir names', async () => {
  const folder = dmfiles.filesDir('Writer');
  assert.ok(folder, 'fixture: filesDir gave no folder for Writer');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'draft.md'), 'd');
  const r = await get('/api/agent/Writer/files');
  assert.equal(r.status, 200, 'the agent with a changed key read as missing');
  assert.deepEqual(r.json.files.map((f) => f.name), ['draft.md']);
  assert.equal(r.json.folder, folder, 'the route listed a different folder than the instruction names');
});

test('limit is clamped; HEAD answers; a Files that is a plain file is a reason, not a crash; refusals name the Files folder', async () => {
  const d = path.join(agentDir('hal'), 'Files');
  fs.mkdirSync(d);
  for (let i = 0; i < 25; i++) fs.writeFileSync(path.join(d, 'f' + i + '.txt'), 'x');
  assert.equal((await get('/api/agent/hal/files')).json.files.length, 20, 'the default cap is not 20');
  assert.equal((await get('/api/agent/hal/files?limit=3')).json.files.length, 3);
  assert.equal((await get('/api/agent/hal/files?limit=0')).json.files.length, 20, 'a zero limit was honoured');
  assert.equal((await get('/api/agent/hal/files?limit=-4')).json.files.length, 20, 'a negative limit was honoured');
  assert.equal((await get('/api/agent/hal/files?limit=100000')).json.total, 25);
  const head = await fetch(base + '/api/agent/hal/files', { method: 'HEAD' });
  assert.equal(head.status, 200);
  fs.writeFileSync(path.join(agentDir('ivy'), 'Files'), 'a file, not a folder');
  const plain = await get('/api/agent/ivy/files');
  assert.equal(plain.status, 200);
  assert.equal(plain.json.ok, false, 'a Files that is a plain file listed as a folder');
  const esc = await post('/api/agent/hal/files/open', { name: '../x' });
  assert.equal(esc.status, 409);
  assert.match(esc.json.because, /this agent\u2019s Files folder/, 'the refusal still talks about a project');
  assert.doesNotMatch(esc.json.because, /project/);
});
