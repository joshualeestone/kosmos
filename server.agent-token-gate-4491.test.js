'use strict';

/**
 * #4491 (proof of concept): on an enforcing board, an agent reaches its everyday routes with ONLY
 * its own agent token, and that token never opens a person-only route.
 *
 * Same harness as server.board-auth-1946.test.js: the board boots fully sandboxed, then
 * enforcement is flipped on in memory, so no real store is touched.
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agenttoken-4491-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
/* The test reaches POST /api/agents (to prove an agent token cannot), so Claude Code's config is
   sandboxed too, as every agent-creating suite must (fixture-discipline.test.js). */
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');

const { start, server, boardAuthState } = require('./server');
const sendertoken = require('./engine/sendertoken');
const fleet = require('./test-support/fleet');
const messagesEngine = require('./engine/messages');
const chatEngine = require('./engine/chat');

const BOARD = 'BOARDTOKEN_test_4491_0123456789abcdef';
const GATE_REFUSAL = /this board belongs to the account that started it/;
let base;
let agentToken;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
  boardAuthState.on = true;
  boardAuthState.token = BOARD;
  const minted = sendertoken.mint('poc-agent');
  assert.ok(minted.ok, 'could not mint an agent token for the test: ' + minted.because);
  agentToken = minted.token;
});

async function call(method, p, { headers = {}, body } = {}) {
  const res = await fetch(base + p, {
    method, redirect: 'manual',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text().catch(() => '');
  return { code: res.status, text };
}
const refusedAtGate = (r) => r.code === 403 && GATE_REFUSAL.test(r.text);

test('CONTROL: an agent route with no credential is refused at the gate', async () => {
  assert.ok(refusedAtGate(await call('POST', '/api/whoami', { body: {} })), 'the gate did not refuse a bare request, so nothing below can be trusted');
});

test('an agent route passes the gate with only a valid agent token (no board token)', async () => {
  for (const [method, p, body] of [['POST', '/api/whoami', {}], ['POST', '/api/msg', { to: 'nobody', text: 'hi' }], ['POST', '/api/post', { project: 'none', text: 'hi' }]]) {
    const r = await call(method, p, { headers: { 'x-kosmos-agent-token': agentToken }, body });
    assert.ok(!refusedAtGate(r), `${method} ${p} was refused at the gate with a valid agent token: ${r.code} ${r.text.slice(0, 120)}`);
  }
});

test('a wrong agent token is refused at the gate', async () => {
  assert.ok(refusedAtGate(await call('POST', '/api/whoami', { headers: { 'x-kosmos-agent-token': 'not-a-token' }, body: {} })));
});

test('an agent token in the BODY does not open the gate (header only, the gate runs before the body)', async () => {
  assert.ok(refusedAtGate(await call('POST', '/api/whoami', { body: { token: agentToken } })));
});

test('an agent token never opens a person-only route', async () => {
  for (const [method, p] of [['POST', '/api/agent/poc-agent/removal'], ['DELETE', '/api/agent/poc-agent/removal'], ['POST', '/api/agents'], ['GET', '/api/status']]) {
    const r = await call(method, p, { headers: { 'x-kosmos-agent-token': agentToken }, body: method === 'GET' ? undefined : {} });
    assert.ok(refusedAtGate(r), `${method} ${p} was reachable with only an agent token: ${r.code}`);
  }
});

test('the caller is identified as the token\'s agent, even when the body names another', async (t) => {
  const board = fleet.install([fleet.agent('poc-agent', { state: 'idle' }), fleet.agent('mara', { state: 'idle' })]);
  t.after(() => board.restore());
  const mara = board.roster.find((c) => c.sessionName === 'mara');
  const maraToken = sendertoken.mint('mara').token;
  const alone = await call('POST', '/api/whoami', { headers: { 'x-kosmos-agent-token': agentToken }, body: {} });
  assert.equal(alone.code, 200);
  assert.equal(JSON.parse(alone.text).agent, 'poc-agent', 'the header token did not identify its own agent: ' + alone.text.slice(0, 160));
  const spoof = await call('POST', '/api/whoami', {
    headers: { 'x-kosmos-agent-token': agentToken },
    body: { token: maraToken, from_pane: mara.session },
  });
  assert.equal(JSON.parse(spoof.text).agent, 'poc-agent', 'a body naming another agent changed who the caller is: ' + spoof.text.slice(0, 160));
  /* CONTROL: the body token IS read when there is no header token (with the board token to pass
     the gate), so the assertion above is the header winning, not the body being ignored. */
  const bodyOnly = await call('POST', '/api/whoami', { headers: { 'x-kosmos-board-token': BOARD }, body: { token: maraToken } });
  assert.equal(JSON.parse(bodyOnly.text).agent, 'mara', 'control: a body token alone did not identify its agent: ' + bodyOnly.text.slice(0, 160));
});

test('a token-only msg is SENT as the token\'s agent, even when the body names another', async (t) => {
  const board = fleet.install([fleet.agent('poc-agent', { state: 'idle' }), fleet.agent('mara', { state: 'idle' })]);
  const sends = [];
  chatEngine.setRunner((args) => {
    sends.push(args);
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  });
  chatEngine.setDryRun(false);
  t.after(() => { messagesEngine.resetForTests(); chatEngine.setRunner(null); chatEngine.setDryRun(true); board.restore(); });
  const mara = board.roster.find((c) => c.sessionName === 'mara');
  const maraToken = sendertoken.mint('mara').token;
  const r = await call('POST', '/api/msg', {
    headers: { 'x-kosmos-agent-token': agentToken },
    body: { to: 'mara', text: 'from the token agent', from_pane: mara.session, token: maraToken },
  });
  assert.equal(r.code, 200, r.text.slice(0, 160));
  assert.equal(JSON.parse(r.text).delivery.state, 'placed', 'the token-only msg was not delivered: ' + r.text.slice(0, 200));
  const pasted = sends.filter((a) => a[0] === 'set-buffer').map((a) => a[a.length - 1]).join('');
  assert.match(pasted, /colleague poc-agent/, 'the msg was not sent as the header token\'s agent');
  assert.doesNotMatch(pasted, /colleague mara/, 'the body\'s pane or token changed the sender');
});

test('a malformed agent token is refused at the gate without a store scan', async (t) => {
  /* Spy on the store scan the gate calls, so this test can see the shape check itself: a malformed
     token must be refused WITHOUT resolveName running, and a well-formed unknown one must run it. */
  const real = sendertoken.resolveName;
  let scans = 0;
  sendertoken.resolveName = (tok) => { scans += 1; return real(tok); };
  t.after(() => { sendertoken.resolveName = real; });
  for (const bad of ['short', 'Z'.repeat(64), agentToken + '0']) {
    assert.ok(refusedAtGate(await call('POST', '/api/whoami', { headers: { 'x-kosmos-agent-token': bad }, body: {} })), 'a malformed token passed: ' + bad.slice(0, 10));
  }
  assert.equal(scans, 0, 'a malformed token still scanned the token store');
  assert.ok(refusedAtGate(await call('POST', '/api/whoami', { headers: { 'x-kosmos-agent-token': 'a'.repeat(64) }, body: {} })));
  assert.ok(scans > 0, 'control: a well-formed unknown token did not reach the store scan, so the spy sees nothing');
});

test('a revoked agent token no longer opens the gate', async () => {
  const gone = sendertoken.mint('gone-agent');
  assert.ok(gone.ok);
  assert.ok(!refusedAtGate(await call('POST', '/api/whoami', { headers: { 'x-kosmos-agent-token': gone.token }, body: {} })), 'control: the fresh token passes');
  sendertoken.revoke('gone-agent');
  assert.ok(refusedAtGate(await call('POST', '/api/whoami', { headers: { 'x-kosmos-agent-token': gone.token }, body: {} })), 'a revoked token still passes the gate');
});

test('the board token still works on the agent routes (nothing that works today breaks)', async () => {
  const r = await call('POST', '/api/whoami', { headers: { 'x-kosmos-board-token': BOARD }, body: {} });
  assert.ok(!refusedAtGate(r), 'the board token no longer reaches whoami');
});

test.after(() => {
  try { server.close(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});
