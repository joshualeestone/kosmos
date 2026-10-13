'use strict';
/**
 * #5977: the Qwen account routes --
 *   POST   /api/accounts/qwen        (add an endpoint account)
 *   DELETE /api/accounts/qwen        (forget, or with remove:true delete)
 *   POST   /api/accounts/qwen/check  (live check)
 *   GET    /api/accounts             (carries Qwen rows)
 * The runner resolver is mocked (never the machine's codex) and the live check runs through setFetcher (never a
 * real endpoint), the harness server.provider-accounts-3296 uses.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-qwen-routes-5977-'));
const mkTemp = (p) => fs.mkdtempSync(nodePath.join(os.tmpdir(), p));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkTemp('aw-qwen-workers-');
process.env.AGENT_WORKFORCE_PROJECTS = mkTemp('aw-qwen-projects-');
process.env.AGENT_WORKFORCE_LAUNCH = mkTemp('aw-qwen-launch-');
process.env.AGENT_WORKFORCE_GEMINI_HOME = nodePath.join(SANDBOX, '.gemini');
process.env.AGENT_WORKFORCE_GROK_HOME = nodePath.join(SANDBOX, '.grok');
process.env.AGENT_WORKFORCE_TMUX_BIN = nodePath.join(__dirname, 'test-support', 'fake-tmux.sh');

const qwen = require('./engine/qwenaccounts');
const runners = require('./engine/runners');
const { start, server } = require('./server');

const _origResolveBin = runners.resolveBin;
runners.resolveBin = (p) => ({ present: true, bin: `/mock/${p}` });

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  runners.resolveBin = _origResolveBin;
  qwen.setFetcher(null);
  try { server.close(); } catch { /* best effort */ }
  for (const d of [SANDBOX, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS, process.env.AGENT_WORKFORCE_LAUNCH]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});
test.afterEach(() => { qwen.setFetcher(null); });

const post = (p, obj) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });
const del = (p, obj) => fetch(base + p, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });
const MODEL = 'kosmos-qwen2.5-7b-16k:latest';
const hasModel = async () => ({ status: 200, body: { data: [{ id: MODEL }] } });

test('add: the local endpoint with its model is stored as "local", connected, with no key in the response', async () => {
  qwen.setFetcher(hasModel);
  const r = await post('/api/accounts/qwen', { baseUrl: 'http://localhost:11434/v1', model: MODEL, name: 'Qwen on this Mac' });
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.account.label, 'local');
  assert.equal(b.account.provider, 'alibaba');
  assert.equal(b.account.name, 'Qwen on this Mac');
  assert.equal(b.account.connection.state, 'connected');
  const dir = nodePath.join(SANDBOX, qwen.DIR_PREFIX + 'local');
  assert.equal(fs.statSync(qwen.endpointFile(dir)).mode & 0o777, 0o600);
  assert.equal(qwen.readEndpoint(dir).endpoint.contextWindow, 16384, 'the measured context is the default');
});

test('add: an endpoint without the model is refused and nothing is stored; an existing account is not overwritten', async () => {
  qwen.setFetcher(async () => ({ status: 200, body: { data: [{ id: 'qwen2.5:7b' }] } }));
  const r = await post('/api/accounts/qwen', { baseUrl: 'http://localhost:11434/v1', model: MODEL, label: 'nomodel' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /does not have the model/);
  assert.equal(fs.existsSync(nodePath.join(SANDBOX, qwen.DIR_PREFIX + 'nomodel')), false);
  qwen.setFetcher(hasModel);
  const again = await post('/api/accounts/qwen', { baseUrl: 'http://localhost:11434/v1', model: MODEL });
  assert.equal(again.status, 409, 'the "local" account from the first test is not overwritten');
});

test('add: an endpoint that cannot be reached is stored and said so; a bad shape is refused before any check', async () => {
  qwen.setFetcher(async () => { throw new Error('ECONNREFUSED'); });
  const r = await post('/api/accounts/qwen', { baseUrl: 'https://qwen.example.com/v1', model: 'qwen-ft-fraud', key: 'sk-company-key-7777', label: 'company' });
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.account.connection.state, 'unknown');
  assert.equal(b.account.keyTail, '7777');
  assert.equal(JSON.stringify(b).includes('sk-company-key-7777'), false, 'the key is never in a response');
  let asked = 0;
  qwen.setFetcher(async () => { asked += 1; return hasModel(); });
  const bad = await post('/api/accounts/qwen', { baseUrl: 'http://localhost:11434/v1', model: MODEL, contextWindow: 4096, label: 'small' });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /16384/);
  assert.equal(asked, 0, 'a refused shape never reaches the endpoint');
});

test('GET /api/accounts carries the Qwen rows, badged from the live check, without keys', async () => {
  qwen.setFetcher(hasModel);
  const r = await fetch(base + '/api/accounts');
  assert.equal(r.status, 200);
  const b = await r.json();
  const rows = b.accounts.filter((a) => a.provider === 'alibaba');
  assert.ok(rows.some((a) => a.label === 'local' && a.connection.badge === 'signed_in_unverified'));
  assert.ok(rows.some((a) => a.label === 'company'));
  assert.equal(JSON.stringify(b).includes('sk-company-key-7777'), false);
});

test('check and delete: a live check answers; forget sets it aside; delete removes it; unknown folders are refused', async () => {
  const dir = nodePath.join(SANDBOX, qwen.DIR_PREFIX + 'company');
  qwen.setFetcher(async () => ({ status: 401, body: null }));
  const c = await post('/api/accounts/qwen/check', { dir });
  assert.equal((await c.json()).state, 'none');
  assert.equal((await post('/api/accounts/qwen/check', { dir: nodePath.join(SANDBOX, qwen.DIR_PREFIX + 'nope') })).status, 404);

  const f = await del('/api/accounts/qwen', { dir });
  assert.equal(f.status, 200);
  const fb = await f.json();
  assert.equal(fb.forgotten, true);
  assert.match(fb.because, /endpoint setting is set aside/);
  assert.equal(fs.existsSync(dir), false);

  const local = nodePath.join(SANDBOX, qwen.DIR_PREFIX + 'local');
  const d = await del('/api/accounts/qwen', { dir: local, remove: true });
  assert.equal(d.status, 200);
  assert.equal((await d.json()).removed, true);
  assert.equal(fs.existsSync(local), false);

  const notOurs = await del('/api/accounts/qwen', { dir: nodePath.join(SANDBOX, '.grok') });
  assert.equal(notOurs.status, 400);
});

test('review 1: two adds racing for one label: exactly one is stored, the other is told the name is taken', async () => {
  qwen.setFetcher(async () => { await new Promise((r) => setTimeout(r, 300)); return hasModel(); });
  const body = { baseUrl: 'http://localhost:11434/v1', model: MODEL, label: 'race' };
  const [a, b] = await Promise.all([post('/api/accounts/qwen', body), post('/api/accounts/qwen', body)]);
  const codes = [a.status, b.status].sort();
  assert.deepEqual(codes, [200, 409], `got ${codes}`);
  // A refused add gives its claimed folder back: a rejected endpoint leaves no folder.
  qwen.setFetcher(async () => ({ status: 200, body: { data: [{ id: 'other' }] } }));
  const r = await post('/api/accounts/qwen', { baseUrl: 'http://localhost:11434/v1', model: MODEL, label: 'giveback' });
  assert.equal(r.status, 400);
  assert.equal(fs.existsSync(nodePath.join(SANDBOX, qwen.DIR_PREFIX + 'giveback')), false);
});

test('review 2: an empty claimed folder left by a crashed add is reclaimed once it is old; a fresh one still says taken', async () => {
  qwen.setFetcher(hasModel);
  const fresh = nodePath.join(SANDBOX, qwen.DIR_PREFIX + 'r2fresh');
  fs.mkdirSync(fresh, { mode: 0o700 });
  const busy = await post('/api/accounts/qwen', { baseUrl: 'http://localhost:11434/v1', model: MODEL, label: 'r2fresh' });
  assert.equal(busy.status, 409, 'CONTROL: a folder claimed a moment ago may be an add still running');
  const stale = nodePath.join(SANDBOX, qwen.DIR_PREFIX + 'r2stale');
  fs.mkdirSync(stale, { mode: 0o700 });
  const old = (Date.now() - 5 * 60000) / 1000;
  fs.utimesSync(stale, old, old);
  const r = await post('/api/accounts/qwen', { baseUrl: 'http://localhost:11434/v1', model: MODEL, label: 'r2stale' });
  assert.equal(r.status, 200, 'the leftover folder still blocks its label');
  assert.ok(fs.existsSync(qwen.endpointFile(stale)), 'the reclaimed folder holds the new account');
  const kept = nodePath.join(SANDBOX, qwen.DIR_PREFIX + 'r2kept');
  fs.mkdirSync(kept, { mode: 0o700 });
  fs.writeFileSync(nodePath.join(kept, 'someone-elses.txt'), 'x');
  fs.utimesSync(kept, old, old);
  const k = await post('/api/accounts/qwen', { baseUrl: 'http://localhost:11434/v1', model: MODEL, label: 'r2kept' });
  assert.equal(k.status, 409, 'CONTROL: an old folder with something in it is never reclaimed');
  assert.ok(fs.existsSync(nodePath.join(kept, 'someone-elses.txt')));
});

test('review 5: an address typed with a trailing slash is checked as it will be stored', async () => {
  const asked = [];
  qwen.setFetcher(async (url) => { asked.push(url); return { status: 200, body: { data: [{ id: 'not-this-one' }] } }; });
  const r = await post('/api/accounts/qwen', { baseUrl: 'http://localhost:11434/v1/', model: MODEL, label: 'r5slash' });
  assert.equal(r.status, 400, 'the endpoint said it lacks the model, so nothing is stored');
  assert.deepEqual(asked, ['http://localhost:11434/v1/models']);
});
