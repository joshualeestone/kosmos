'use strict';
/**
 * #2338: the 3 OpenAI subscription routes wire the ChatGPT-login DRIVER to HTTP
 * (POST .../subscription/start, GET .../status, POST .../cancel). This tests the
 * ROUTING (validation, needsRunner, the response shapes Kitty's picker keys on)
 * with the driver and the runner resolver MOCKED -- so it never spawns a real
 * `codex login`. The driver lifecycle itself is covered by
 * engine/openaiaccounts.chatgpt-driver-2338.test.js.
 *
 *   node --test server.openai-subscription-2338.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-sub-routes-2338-'));
const mkTemp = (p) => fs.mkdtempSync(nodePath.join(os.tmpdir(), p));
// Sandbox EVERY fleet root, or server.js refuses a half-sandboxed boot (#634).
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkTemp('aw-sub-workers-');
process.env.AGENT_WORKFORCE_PROJECTS = mkTemp('aw-sub-projects-');
process.env.AGENT_WORKFORCE_LAUNCH = mkTemp('aw-sub-launch-');
process.env.AGENT_WORKFORCE_TMUX_BIN = nodePath.join(__dirname, 'test-support', 'fake-tmux.sh');

const openai = require('./engine/openaiaccounts');
const runners = require('./engine/runners');
const { start, server } = require('./server');

// Mock the runner as PRESENT so `start` reaches the driver (never the machine's codex).
runners.resolveBin = () => ({ present: true, bin: '/mock/codex' });
runners.status = () => ({ openai: { job: { phase: 'installed' } } });
// Mock the driver so no real `codex login` is ever spawned.
let lastStartArgs = null;
openai.startChatgptLogin = (a) => { lastStartArgs = a; return { ok: true, sessionId: 'sess-1', mode: a.mode === 'device' ? 'device' : 'browser', authUrl: 'https://auth.example/x', userCode: a.mode === 'device' ? 'WXYZ-1234' : undefined }; };
openai.chatgptLoginStatus = (id) => (id === 'sess-1' ? { ok: true, state: 'connected', authUrl: 'https://auth.example/x', userCode: 'WXYZ-1234', account: { provider: 'openai', authMode: 'chatgpt', keyTail: null, email: 'p@e.co' } } : { ok: false, because: 'no such sign-in in progress' });
openai.cancelChatgptLogin = (id) => (id === 'sess-1' ? { ok: true, cancelled: true } : { ok: false, because: 'no such sign-in in progress' });

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { try { server.close(); } catch { /* best effort */ } try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const post = (p, obj) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });
const get = (p) => fetch(base + p);

test('POST subscription/start returns ONLY the session + mode (authUrl/userCode come from status) and passes mode/label to the driver', async () => {
  const r = await post('/api/accounts/openai/subscription/start', { mode: 'device', label: 'Side' });
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.sessionId, 'sess-1');
  assert.equal(b.mode, 'device');
  // authUrl/userCode are printed by codex AFTER start returns, so the start
  // response must NOT advertise them (they were structurally always undefined).
  assert.equal(b.authUrl, undefined, 'start does not carry authUrl (the client polls status)');
  assert.equal(b.userCode, undefined, 'start does not carry userCode (the client polls status)');
  assert.deepEqual({ mode: lastStartArgs.mode, label: lastStartArgs.label }, { mode: 'device', label: 'Side' });
  assert.equal(lastStartArgs.codexBin, '/mock/codex', 'the route hands the resolved codex bin to the driver');
});

test('#2584: subscription/start threads reauthDir to the driver (present -> passed; absent/empty -> undefined)', async () => {
  await post('/api/accounts/openai/subscription/start', { mode: 'browser', reauthDir: '/Users/x/.codex-acct' });
  assert.equal(lastStartArgs.reauthDir, '/Users/x/.codex-acct', 'a reauth start hands the target dir to the driver');
  // A normal add must never be accidentally a reauth.
  await post('/api/accounts/openai/subscription/start', { mode: 'browser' });
  assert.equal(lastStartArgs.reauthDir, undefined, 'a normal add passes no reauthDir');
  // An empty string is not a target; it must not be forwarded (the driver would
  // treat any truthy dir as a reauth).
  await post('/api/accounts/openai/subscription/start', { mode: 'browser', reauthDir: '' });
  assert.equal(lastStartArgs.reauthDir, undefined, 'an empty reauthDir is not forwarded as a reauth');
});

test('GET subscription/status returns the state + account AND the auth prompt (authUrl/userCode)', async () => {
  const r = await get('/api/accounts/openai/subscription/status?sessionId=sess-1');
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.state, 'connected');
  assert.equal(b.account.authMode, 'chatgpt');
  assert.equal(b.account.keyTail, null, 'the subscription discriminator: no keyTail');
  // The auth prompt the picker opens is read HERE, not from start.
  assert.match(b.authUrl, /^https:/, 'status carries the auth URL the picker opens');
  assert.equal(b.userCode, 'WXYZ-1234', 'status carries the device user code');
});

test('GET subscription/status 404s an unknown session', async () => {
  const r = await get('/api/accounts/openai/subscription/status?sessionId=nope');
  assert.equal(r.status, 404);
});

test('POST subscription/cancel tears down a known session; 404 for unknown', async () => {
  const ok = await post('/api/accounts/openai/subscription/cancel', { sessionId: 'sess-1' });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).cancelled, true);
  const bad = await post('/api/accounts/openai/subscription/cancel', { sessionId: 'nope' });
  assert.equal(bad.status, 404);
});

test('start surfaces needsRunner when the OpenAI runner is not installed', async () => {
  const saved = runners.resolveBin;
  runners.resolveBin = () => ({ present: false });
  try {
    const r = await post('/api/accounts/openai/subscription/start', {});
    assert.equal(r.status, 400);
    const b = await r.json();
    assert.equal(b.needsRunner, true);
    assert.equal(b.provider, 'openai');
  } finally { runners.resolveBin = saved; }
});
