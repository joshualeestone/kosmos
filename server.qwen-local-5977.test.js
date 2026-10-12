'use strict';
/**
 * #5977 slice 3: the Qwen-on-this-computer routes --
 *   GET  /api/accounts/qwen/local           (what is missing; never changes anything)
 *   POST /api/accounts/qwen/local/model     (make the 16k model; no download)
 *   POST /api/accounts/qwen/local/download  (only with { confirm: true })
 * Ollama is replaced through qwenlocal.setTransport (never a real one), in the server.qwen-accounts-5977 harness.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-qwen-local-5977-'));
const mkTemp = (p) => fs.mkdtempSync(nodePath.join(os.tmpdir(), p));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkTemp('aw-qwenlocal-workers-');
process.env.AGENT_WORKFORCE_PROJECTS = mkTemp('aw-qwenlocal-projects-');
process.env.AGENT_WORKFORCE_LAUNCH = mkTemp('aw-qwenlocal-launch-');
process.env.AGENT_WORKFORCE_GEMINI_HOME = nodePath.join(SANDBOX, '.gemini');
process.env.AGENT_WORKFORCE_GROK_HOME = nodePath.join(SANDBOX, '.grok');
process.env.AGENT_WORKFORCE_TMUX_BIN = nodePath.join(__dirname, 'test-support', 'fake-tmux.sh');

const local = require('./engine/qwenlocal');
const { start, server } = require('./server');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  local.resetForTest();
  try { server.close(); } catch { /* best effort */ }
  for (const d of [SANDBOX, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS, process.env.AGENT_WORKFORCE_LAUNCH]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});
test.afterEach(() => local.resetForTest());

const post = (p, obj) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });
function ollama(names, extra) {
  const calls = [];
  local.setTransport(async (p, o) => {
    calls.push({ p, method: (o && o.method) || 'GET' });
    if (extra && extra[p]) return extra[p](o);
    if (p === '/api/tags') return { status: 200, body: { models: names.map((name) => ({ name })) } };
    return { status: 404, body: null };
  });
  return calls;
}
const settle = async () => { for (let i = 0; i < 40 && local.pullProgress() && local.pullProgress().running; i += 1) await new Promise((r) => setTimeout(r, 5)); };

test('GET says what is missing and only reads', async () => {
  const calls = ollama(['qwen2.5:7b']);
  const r = await fetch(base + '/api/accounts/qwen/local');
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.state, 'needs_model');
  assert.equal(b.model, 'kosmos-qwen2.5-7b-16k:latest');
  assert.deepEqual(calls.map((c) => c.method), ['GET']);
  local.setTransport(async () => ({ unreachable: true }));
  assert.equal((await (await fetch(base + '/api/accounts/qwen/local')).json()).state, 'no_ollama');
});

test('a download starts only with the person\'s confirm, and only when the base is missing', async () => {
  let calls = ollama([], { '/api/pull': async () => ({ status: 200, body: { status: 'success' } }), '/api/create': async () => ({ status: 200, body: { status: 'success' } }) });
  const no = await post('/api/accounts/qwen/local/download', {});
  assert.equal(no.status, 400);
  assert.equal(calls.some((c) => c.p === '/api/pull'), false, 'no confirm, no download');
  const yes = await post('/api/accounts/qwen/local/download', { confirm: true });
  assert.equal(yes.status, 202);
  await settle();
  assert.ok(calls.some((c) => c.p === '/api/pull'), 'CONTROL: the confirmed download ran');
  calls = ollama(['qwen2.5:7b'], { '/api/pull': async () => ({ status: 200, body: { status: 'success' } }) });
  const have = await post('/api/accounts/qwen/local/download', { confirm: true });
  assert.equal(have.status, 409, 'nothing to download when the base is there');
  assert.equal(calls.some((c) => c.p === '/api/pull'), false);
});

test('model: makes the 16k copy when the base is there, refuses when it is not, and is a no-op when ready', async () => {
  let calls = ollama(['qwen2.5:7b'], { '/api/create': async () => ({ status: 200, body: { status: 'success' } }) });
  const r = await post('/api/accounts/qwen/local/model', {});
  assert.equal(r.status, 200);
  assert.ok(calls.some((c) => c.p === '/api/create'));
  calls = ollama([]);
  assert.equal((await post('/api/accounts/qwen/local/model', {})).status, 409, 'no base: nothing to copy');
  assert.equal(calls.some((c) => c.p === '/api/create'), false);
  calls = ollama(['kosmos-qwen2.5-7b-16k:latest']);
  assert.equal((await post('/api/accounts/qwen/local/model', {})).status, 200);
  assert.equal(calls.some((c) => c.p === '/api/create'), false, 'already there: not made again');
});
