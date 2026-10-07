'use strict';
/**
 * #5359: `kosmos accounts`, the agent's read of the board's provider accounts (GET /api/accounts), so an agent no
 * longer hand-rolls the authenticated read. The Windows half is tools.windows-kosmos-cli-accounts-5359.test.js, held
 * to the same lines.
 *
 * Harness as cli.connections-4451.test.js: an in-process stub answering the CLI's own health check with a page
 * containing "Kosmos", and ASYNC child processes (a synchronous one blocks the stub's event loop).
 */
require('./test-support/tmpscope');   // #4273: first, so every temp dir this file makes is contained and removed
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
/* #4796: the CLI reads the board token from the data root. A fresh one here, so the live board's token never
   travels to this test's stub board. */
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-accounts-5359-'));
process.on('exit', () => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ } });
// The CLI reads board.token from store.ROOT under this data root; ask store where that is rather than assume it.
process.env.AGENT_WORKFORCE_DATA = DATA;
const ROOT = require('./engine/store').ROOT;
fs.mkdirSync(ROOT, { recursive: true });
fs.writeFileSync(path.join(ROOT, 'board.token'), 'board-tok-5359\n', { mode: 0o600 });

const CLI = path.join(__dirname, 'install', 'kosmos');

function withStub(answers, fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers });
      const a = answers[req.method + ' ' + req.url];
      if (a && typeof a.raw === 'string') { res.writeHead(a.status || 200, { 'content-type': 'text/html' }); return res.end(a.raw); }
      if (a) { res.writeHead(a.status || 200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(a.json)); }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<title>Kosmos</title>Agent Workforce');
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn(server.address().port, seen); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

function cli(port, args) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port) };
    delete env.KOSMOS_AGENT_TOKEN;
    const child = spawn(CLI, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const t = setTimeout(() => child.kill('SIGKILL'), 20000);
    child.on('close', (code, sig) => {
      clearTimeout(t);
      const r = { code, out };
      /* #3628: a killed CLI has no exit code; it must fail the test, never read as one. */
      if (typeof r.code !== 'number') { reject(new Error('the CLI gave no exit code (' + sig + '): killed by the 20s limit. ' + out)); return; }
      resolve(r);
    });
  });
}

const ACCOUNTS = { accounts: [
  { provider: 'anthropic', providerName: 'Anthropic / Claude', email: 'a@example.com', authMode: 'subscription', connection: { state: 'connected', badge: 'working' } },
  // Review 1 (BLOCKER): a credential on disk is state "connected" even when its last request was refused (#874).
  { provider: 'anthropic', providerName: 'Anthropic / Claude', email: 'r@example.com', authMode: 'subscription', connection: { state: 'connected', badge: 'rejected' } },
  { provider: 'anthropic', providerName: 'Anthropic / Claude', email: 'u@example.com', connection: { state: 'connected', badge: 'signed_in_unverified' } },
  { provider: 'anthropic', providerName: 'Anthropic / Claude', email: 's@example.com', connection: { state: 'connected', badge: 'working', loginStopsAt: Date.now() + 3 * 3600 * 1000 } },
  { provider: 'openai', providerName: 'OpenAI', email: 'b@example.com', authMode: 'chatgpt', connection: { state: 'unknown', liveCheckPending: true } },
  { provider: 'google', providerName: 'Google Gemini', authMode: 'apikey', connection: { state: 'none', because: 'the key was refused' } },
  { provider: 'xai', providerName: 'xAI Grok', email: 'c@example.com', connection: { state: 'unknown', because: 'we could not check this account just now' } },
  // Review 2: a key row with no badge (state alone), a stop time already past (falls through to the badge), and a
  // refused login whose stop time is ahead (the stop notice comes first, as on the board).
  { provider: 'google', providerName: 'Google Gemini', email: 'k@example.com', authMode: 'apikey', connection: { state: 'connected' } },
  // Review 4: rows the board names without an email: a key ending, a chosen name, and the two subscription sign-ins.
  { provider: 'xai', providerName: 'xAI Grok', authMode: 'apikey', keyTail: '7f3q', connection: { state: 'connected' } },
  { provider: 'openai', providerName: 'OpenAI', authMode: 'apikey', name: 'Research key', keyTail: '9a1b', connection: { state: 'connected' } },
  { provider: 'antigravity', providerName: 'Gemini', authMode: 'antigravity', email: null, connection: { state: 'connected', checkedLive: false, badge: 'signed_in_unverified' } },
  { provider: 'meta', providerName: 'Meta', authMode: 'muse', email: null, connection: { state: 'none', checkedLive: false, badge: 'rejected' } },
  // Review 3: a ChatGPT sign-in whose free check finished with no answer: the board shows it as signed in (amber).
  { provider: 'openai', providerName: 'OpenAI', email: 'g@example.com', authMode: 'chatgpt', connection: { state: 'unknown', because: 'not yet checked' } },
  { provider: 'anthropic', providerName: 'Anthropic / Claude', email: 'p@example.com', connection: { state: 'connected', badge: 'working', loginStopsAt: Date.now() - 3600 * 1000 } },
  { provider: 'anthropic', providerName: 'Anthropic / Claude', email: 'x@example.com', connection: { state: 'connected', badge: 'rejected', loginStopsAt: Date.now() + 3600 * 1000 } },
] };

test('#5359: kosmos accounts reads /api/accounts with the board token, and says each account\'s state in words', () => withStub({ 'GET /api/accounts': { json: ACCOUNTS } }, async (port, seen) => {
  const r = await cli(port, ['accounts']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^Anthropic \/ Claude: a@example\.com \(subscription\): signed in$/m);
  assert.match(r.out, /^Anthropic \/ Claude: r@example\.com \(subscription\): not signed in: its last request was refused\./m, 'a refused login read as signed in');
  assert.match(r.out, /^Anthropic \/ Claude: u@example\.com: signed in by Kosmos's record, not yet confirmed by a real request$/m);
  assert.match(r.out, /^Anthropic \/ Claude: s@example\.com: its sign-in has run out; its agents keep working until .+, then stop\./m);
  assert.match(r.out, /^OpenAI: b@example\.com \(chatgpt\): being checked now; it is known on the next read$/m);
  assert.match(r.out, /^Google Gemini: k@example\.com \(apikey\): signed in$/m, 'a row with no badge lost its state');
  assert.match(r.out, /^xAI Grok: API key ending 7f3q \(apikey\): signed in$/m, 'a keyed account was not named by its key ending');
  assert.match(r.out, /^OpenAI: Research key \(apikey\): signed in$/m, 'a chosen name was not used');
  assert.match(r.out, /^Gemini: its Google subscription sign-in \(antigravity\): signed in by Kosmos's record, not yet confirmed by a real request$/m);
  assert.match(r.out, /^Meta: its Meta account sign-in \(muse\): not signed in: its last request was refused\./m);
  assert.match(r.out, /^OpenAI: g@example\.com \(chatgpt\): signed in by its own record, not yet confirmed by a real request$/m, 'a ChatGPT row read unlike the board');
  assert.match(r.out, /^Anthropic \/ Claude: p@example\.com: signed in$/m, 'a stop time already past still said they stop');
  assert.match(r.out, /^Anthropic \/ Claude: x@example\.com: its sign-in has run out; its agents keep working until /m, 'the stop notice did not come first');
  assert.match(r.out, /^Google Gemini: an account with no name or email on record \(apikey\): not signed in: the key was refused$/m);
  assert.match(r.out, /^xAI Grok: c@example\.com: could not be checked just now: we could not check this account just now$/m);
  const q = seen.find((x) => x.url === '/api/accounts');
  assert.ok(q, 'CONTROL: the route was not asked');
  assert.equal(q.headers['x-kosmos-board-token'], 'board-tok-5359', 'the board token did not reach the route');
}));

test('#5359: kosmos accounts says when there are none, when the board refuses, and when the answer is unreadable', async () => {
  await withStub({ 'GET /api/accounts': { json: { accounts: [] } } }, async (port) => {
    const r = await cli(port, ['accounts']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /No provider accounts are set up on this board yet/);
  });
  await withStub({ 'GET /api/accounts': { status: 401, json: { error: 'that needs the board token' } } }, async (port) => {
    const r = await cli(port, ['accounts']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /Kosmos refused that request: that needs the board token\./);
  });
  // Review 1: a fault on the board is not a refusal, and is not told as one.
  await withStub({ 'GET /api/accounts': { status: 500, json: { error: 'we could not read the accounts on this computer' } } }, async (port) => {
    const r = await cli(port, ['accounts']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /Kosmos could not read its accounts just now: we could not read the accounts on this computer\. Try again in a minute\./);
    assert.doesNotMatch(r.out, /refused/);
  });
  // A 4xx that gives no reason is not called a refusal (the same class on both CLIs).
  await withStub({ 'GET /api/accounts': { status: 403, json: {} } }, async (port) => {
    const r = await cli(port, ['accounts']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /Kosmos could not read its accounts just now\. Try again in a minute\./);
    assert.doesNotMatch(r.out, /refused/);
  });
  // Review 3: a 5xx that is not JSON (a proxy's page) is still a fault, never "could not read the answer".
  await withStub({ 'GET /api/accounts': { status: 502, raw: '<html>Bad gateway</html>' } }, async (port) => {
    const r = await cli(port, ['accounts']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /Kosmos could not read its accounts just now\. Try again in a minute\./);
  });
  await withStub({ 'GET /api/accounts': { json: { something: 'else' } } }, async (port) => {
    const r = await cli(port, ['accounts']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /an answer we could not read about its accounts/);
  });
});

test('#5359: kosmos accounts --help prints its usage and never runs the live check', () => withStub({ 'GET /api/accounts': { json: ACCOUNTS } }, async (port, seen) => {
  const r = await cli(port, ['accounts', '--help']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^Usage: kosmos accounts /m);
  assert.equal(seen.filter((x) => x.url === '/api/accounts').length, 0, '--help ran the live check');
}));

test('#5359: kosmos accounts says so when no board answers', async () => {
  // A port nothing listens on: taken from a stub that is then closed.
  const port = await new Promise((resolve) => { const sv = http.createServer(); sv.listen(0, '127.0.0.1', () => { const p = sv.address().port; sv.close(() => resolve(p)); }); });
  const r = await cli(port, ['accounts']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /which accounts are set up/);
});
