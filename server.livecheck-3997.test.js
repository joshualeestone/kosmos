'use strict';
/*
 * #3997 (Josh, 2026-09-26: "only some of these that are signed in are actually green"). The FREE live checks behind
 * the AI Models rows: a ChatGPT sign-in (codex's own handshake, faked through codexsigninlive.setRunner) and a Grok
 * subscription (the models listing, faked through grokaccounts.setFetcher). Nothing here reaches OpenAI or xAI.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'srv-livecheck-3997-'));
const HOME = nodePath.join(SANDBOX, 'home');
for (const d of [HOME, nodePath.join(SANDBOX, 'data'), nodePath.join(SANDBOX, 'workers'), nodePath.join(SANDBOX, 'launch'), nodePath.join(SANDBOX, 'projects')]) {
  fs.mkdirSync(d, { recursive: true });
}
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_GROK_HOME = nodePath.join(HOME, '.grok');
process.env.AGENT_WORKFORCE_GEMINI_HOME = nodePath.join(HOME, '.gemini');
process.env.AGENT_WORKFORCE_TMUX_BIN = nodePath.join(__dirname, 'test-support', 'fake-tmux.sh');
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;

const CODEX = nodePath.join(HOME, '.codex');
fs.mkdirSync(CODEX, { recursive: true });
const idPayload = Buffer.from(JSON.stringify({ email: 'sub@example.com' })).toString('base64url');
fs.writeFileSync(nodePath.join(CODEX, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: 'x.' + idPayload + '.y' } }));

// An API-KEY OpenAI account beside it: the ChatGPT Check now must refuse it (it is not a sign-in).
const CODEX_KEY = nodePath.join(HOME, '.codex-key');
fs.mkdirSync(CODEX_KEY, { recursive: true });
fs.writeFileSync(nodePath.join(CODEX_KEY, 'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-workingkeyworkingKEYX' }));

const GROK = nodePath.join(HOME, '.grok');
fs.mkdirSync(GROK, { recursive: true });
function grokSignIn(expiresInMs) {
  fs.writeFileSync(nodePath.join(GROK, 'auth.json'), JSON.stringify({ 'https://auth.x.ai::1': {
    key: 'sess', refresh_token: 'r', email: 'g@example.com', expires_at: new Date(Date.now() + expiresInMs).toISOString() } }));
}

const codexsigninlive = require('./engine/codexsigninlive');
const grokAccounts = require('./engine/grokaccounts');
const observed = require('./engine/observed');
const { start, server } = require('./server');

const DOC = (ws) => JSON.stringify({ checks: {
  'network.websocket_reachability': { status: ws },
  'network.provider_reachability': { status: 'ok', details: { 'reachability mode': 'ChatGPT auth' } },
} });

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  codexsigninlive.resetForTest(); grokAccounts.setFetcher(null);
  try { server.close(); } catch { /* best effort */ }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});
test.beforeEach(() => { codexsigninlive.resetForTest(); grokAccounts.setFetcher(null); observed._clearForTest(); });

const accounts = async () => ((await (await fetch(base + '/api/accounts')).json()).accounts || []);
const post = (p, obj) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });

test('#3997 ChatGPT: opening the list STARTS the free check without waiting, says so, and the next read is green', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let runs = 0;
  codexsigninlive.setRunner(async () => { runs++; await gate; return { ok: true, stdout: DOC('ok') }; });
  grokSignIn(3 * 3600 * 1000);
  grokAccounts.setFetcher(async () => ({ status: 200 }));
  const first = (await accounts()).find((a) => a.provider === 'openai');
  assert.equal(runs, 1, 'opening the list did not start the ChatGPT check');
  assert.equal(first.connection.state, 'unknown', 'the read waited for the handshake (#1921: it must not)');
  assert.equal(first.connection.liveCheckPending, true);
  release();
  await new Promise((r) => setTimeout(r, 50));
  const second = (await accounts()).find((a) => a.provider === 'openai');
  assert.equal(second.connection.state, 'connected', JSON.stringify(second.connection));
  assert.ok(!second.connection.liveCheckPending, 'a warm row still says a check is under way');
  assert.equal(runs, 1, 'a warm row started another check');
});

test('#3997 Grok subscription: a current key checked live on open reads working; an expired one stays unconfirmed with its reason', async () => {
  let calls = 0;
  grokAccounts.setFetcher(async () => { calls++; return { status: 200 }; });
  codexsigninlive.setRunner(async () => ({ ok: false }));
  grokSignIn(3 * 3600 * 1000);
  let row = (await accounts()).find((a) => a.provider === 'xai');
  assert.equal(calls, 1);
  assert.equal(row.connection.badge, 'working', JSON.stringify(row.connection));
  // An expired key is not sent anywhere, and the row says why it is not green.
  observed._clearForTest();   // forget that green, as a stale one would be
  grokSignIn(-60 * 1000);
  calls = 0;
  row = (await accounts()).find((a) => a.provider === 'xai');
  assert.equal(row.connection.badge, 'signed_in_unverified', JSON.stringify(row.connection));
  assert.match(row.connection.because, /renews this sign-in the next time it runs/);
  assert.equal(calls, 0, 'an expired Grok key was sent to Grok');
});

test('#3997 Check now routes: connected, none and unknown, and a wrong kind of account is refused', async () => {
  codexsigninlive.setRunner(async () => ({ ok: true, stdout: DOC('ok') }));
  let j = await (await post('/api/accounts/openai/check', { dir: CODEX })).json();
  assert.equal(j.state, 'connected');
  codexsigninlive.resetForTest();
  codexsigninlive.setRunner(async () => ({ ok: true, stdout: DOC('warning') }));
  j = await (await post('/api/accounts/openai/check', { dir: CODEX })).json();
  assert.equal(j.state, 'none');
  grokSignIn(3 * 3600 * 1000);
  grokAccounts.setFetcher(async () => ({ status: 401 }));
  j = await (await post('/api/accounts/grok/check', { dir: GROK })).json();
  assert.equal(j.state, 'unknown', 'a 401 is not confirmed dead');
  assert.match(j.because, /Signing in again/);
  observed._clearForTest();
  grokAccounts.setFetcher(async () => ({ status: 200 }));
  j = await (await post('/api/accounts/grok/check', { dir: GROK })).json();
  assert.equal(j.state, 'connected');
  // The list read below cannot confirm anything itself (Grok answers 500), so only Check now's answer can green it.
  grokAccounts.setFetcher(async () => ({ status: 500 }));
  const row = (await accounts()).find((a) => a.provider === 'xai');
  assert.equal(row.connection.badge, 'working', 'Check now did not turn the row green');
  // A ChatGPT dir asked on the Grok route (and a stranger's folder) is not an account of that kind.
  assert.equal((await post('/api/accounts/grok/check', { dir: CODEX })).status, 404);
  assert.ok((await accounts()).some((a) => a.dir === CODEX_KEY), 'CONTROL: the api-key account is a listed OpenAI account');
  assert.equal((await post('/api/accounts/openai/check', { dir: CODEX_KEY })).status, 404, 'an api-key account was checked as a ChatGPT sign-in');
  assert.equal((await post('/api/accounts/openai/check', { dir: nodePath.join(SANDBOX, 'nope') })).status, 404);
  assert.equal((await post('/api/accounts/openai/check', {})).status, 400);
});
