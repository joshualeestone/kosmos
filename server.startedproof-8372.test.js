'use strict';
/*
 * kosmos#8372: on Windows a session's roster row appears only once Claude Code registers it, a moment after
 * SessionStart, and the heartbeat is written only after an authenticated report. So the `started` report passed
 * neither of resolveAgentSender's paths and every session opened with "reporting is OFF" while its later reports
 * landed. A `started` report on the agent's own held, unambiguous token now proves life by itself.
 *   node --test server.startedproof-8372.test.js
 */
require('./test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-startedproof-8372-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-startedproof-8372-home-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-startedproof-8372-work-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-startedproof-8372-proj-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-startedproof-8372-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const serverMod = require('./server');
const { start, server } = serverMod;
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const liveness = require('./engine/liveness');
const store = require('./engine/store');

// kosmos#8372 review 2: path 2b exists only on a board running on Windows; these tests are that board.
test.before(async () => { serverMod._setStartedProofPlatformForTest('win32'); await start(0); });
test.after(() => {
  serverMod._setStartedProofPlatformForTest(null);
  server.closeAllConnections(); server.close();
  for (const d of [SANDBOX, process.env.HOME]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

async function report(body, token) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/report`, {
    method: 'POST',
    headers: Object.assign({ 'content-type': 'application/json' }, token ? { 'x-kosmos-agent-token': token } : {}),
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}
// The board knows only mara (a pane row). The Windows agents below have a held token and NO row: Claude Code has not
// registered their session yet.
function board(t) {
  const b = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  t.after(() => b.restore());
}

test('kosmos#8372: a session\'s first report (started) on its own held token is recorded with no row and no heartbeat yet, and its next reports pass', async (t) => {
  board(t);
  store.writeProfile('winagent', { displayName: 'Win Agent' });   // a Windows agent Kosmos created
  const tok = sendertoken.mint('winagent').token;
  assert.notEqual(liveness.alive('winagent'), true, 'CONTROL: no heartbeat before the first report');
  const first = await report({ state: 'started', auto: true }, tok);
  assert.equal(first.json.recorded, true, 'the session start was refused: ' + JSON.stringify(first.json));
  assert.equal(liveness.alive('winagent'), true, 'the start did not beat liveness');
  const next = await report({ state: 'working', auto: true }, tok);
  assert.equal(next.json.recorded, true, 'the next report was refused: ' + JSON.stringify(next.json));
});

test('kosmos#8372 CONTROL: without a start first, a no-row agent\'s working report is still refused, as before', async (t) => {
  board(t);
  store.writeProfile('coldagent', { displayName: 'Cold' });
  const tok = sendertoken.mint('coldagent').token;
  const r = await report({ state: 'working', auto: true }, tok);
  assert.equal(r.json.recorded, false);
  assert.equal(r.json.because, 'we could not match that to one of your agents');
});

test('kosmos#8372: a start on a token that is not held (never issued, or revoked) is refused exactly as before', async (t) => {
  board(t);
  const never = await report({ state: 'started', auto: true }, 'ab'.repeat(32));
  assert.equal(never.json.recorded, false);
  assert.equal(never.json.because, 'we could not match that to one of your agents');
  store.writeProfile('goneagent', { displayName: 'Gone' });
  const m = sendertoken.mint('goneagent');
  sendertoken.revoke('goneagent');
  const gone = await report({ state: 'started', auto: true }, m.token);
  assert.equal(gone.json.recorded, false, 'a revoked token started a session: ' + JSON.stringify(gone.json));
  assert.equal(liveness.alive('goneagent'), null, 'a refused start beat liveness');
});

test('kosmos#8372 review 1: a retired run token (empty list, as a run end leaves it) cannot start a session', async (t) => {
  board(t);
  store.writeProfile('retiredagent', { displayName: 'Retired' });
  const m = sendertoken.mint('retiredagent');
  sendertoken.retire('retiredagent', m.instance);
  const r = await report({ state: 'started', auto: true }, m.token);
  assert.equal(r.json.recorded, false, JSON.stringify(r.json));
  assert.equal(liveness.alive('retiredagent'), null);
});

test('kosmos#8372 review 1: a start cannot bootstrap a remote-issued token, a never-created name, a removed agent, or a forwarded request', async (t) => {
  board(t);
  // CONTROL in this test: a local, created, launched agent's start is recorded.
  store.writeProfile('okagent', { displayName: 'Ok' });
  assert.equal((await report({ state: 'started', auto: true }, sendertoken.mint('okagent').token)).json.recorded, true, 'CONTROL failed');
  // A token issued to another computer (POST /api/agent-token tags it 'remote'; nothing retires those).
  store.writeProfile('faragent', { displayName: 'Far' });
  const far = await report({ state: 'started', auto: true }, sendertoken.mint('faragent', { launcher: 'remote' }).token);
  assert.equal(far.json.recorded, false, 'a remote-issued token started a session: ' + JSON.stringify(far.json));
  // A name Kosmos never created (no profile).
  const ghost = await report({ state: 'started', auto: true }, sendertoken.mint('ghostagent').token);
  assert.equal(ghost.json.recorded, false, 'a never-created name started a session');
  // An agent the person removed, whose token was left (a failed revoke).
  store.writeProfile('removedagent', { displayName: 'Removed' });
  const rtok = sendertoken.mint('removedagent').token;
  fs.writeFileSync(path.join(store.ROOT, 'removed.json'), JSON.stringify([{ name: 'removedagent', shownAs: 'Removed', removedAt: new Date().toISOString() }]));
  t.after(() => fs.rmSync(path.join(store.ROOT, 'removed.json'), { force: true }));
  assert.equal((await report({ state: 'started', auto: true }, rtok)).json.recorded, false, 'a removed agent started a session');
  // The same local, created agent's start, but forwarded (a remote session): refused.
  store.writeProfile('fwdagent', { displayName: 'Fwd' });
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/report`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': sendertoken.mint('fwdagent').token, 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify({ state: 'started', auto: true }),
  });
  const fwd = await res.json();
  assert.equal(res.status, 200, 'the forwarded start was refused before the route (so this arm would test nothing): ' + JSON.stringify(fwd));
  assert.equal(fwd.recorded, false, 'a forwarded start bootstrapped a heartbeat: ' + JSON.stringify(fwd));
  assert.equal(fwd.because, 'we could not match that to one of your agents');
  for (const n of ['faragent', 'ghostagent', 'removedagent', 'fwdagent']) assert.notEqual(liveness.alive(n), true, n + ' got a heartbeat');
});

test('kosmos#8372 review 2: on a Mac (or Linux) board a start proves nothing new: its pane exists first, and a kept run token stays mute', async (t) => {
  board(t);
  store.writeProfile('macagent', { displayName: 'Mac' });
  const tok = sendertoken.mint('macagent').token;
  serverMod._setStartedProofPlatformForTest('darwin');
  t.after(() => serverMod._setStartedProofPlatformForTest('win32'));
  const r = await report({ state: 'started', auto: true }, tok);
  assert.equal(r.json.recorded, false, 'a Mac board let a token start a session with no pane: ' + JSON.stringify(r.json));
  assert.notEqual(liveness.alive('macagent'), true);
});

test('kosmos#8372 review 2: a brand-new Windows agent (its session recorded, its profile not written yet) has its first start recorded', async (t) => {
  board(t);
  const win32sessions = require('./engine/win32sessions');
  assert.equal(win32sessions.record('sess-newagent-1', { name: 'newagent', runner: 'claude' }).ok, true, 'CONTROL: the session was recorded');
  const tok = sendertoken.mint('newagent').token;
  const r = await report({ state: 'started', auto: true }, tok);
  assert.equal(r.json.recorded, true, 'a new agent with only its session record was refused: ' + JSON.stringify(r.json));
});

test('kosmos#8372 review 3: a start from a non-loopback socket peer (the network bind open, no forwarding header) is refused', async (t) => {
  board(t);
  const http = require('node:http');
  const handlers = server.listeners('request');
  // The real route, with the request's socket peer set by hand, as a direct caller's would be.
  const startFrom = (peer, tok) => new Promise((resolve, reject) => {
    const req = new http.IncomingMessage({ remoteAddress: peer, destroy() {}, on() {}, once() {}, removeListener() {} });
    req.method = 'POST'; req.url = '/api/report';
    req.headers = { 'content-type': 'application/json', 'x-kosmos-agent-token': tok, host: '127.0.0.1:' + server.address().port };
    const out = new http.ServerResponse(req);
    let body = '';
    out.write = (c) => { body += c; return true; };
    out.end = (c) => { if (c) body += c; resolve({ status: out.statusCode, json: JSON.parse(body || '{}') }); return out; };
    try { for (const h of handlers) h.call(server, req, out); } catch (e) { reject(e); }
    req.push(JSON.stringify({ state: 'started', auto: true })); req.push(null);
  });
  // CONTROL (review 4): the same hand-built request from a loopback peer is recorded, so the harness reaches the route.
  store.writeProfile('loopagent', { displayName: 'Loop' });
  const ok = await startFrom('127.0.0.1', sendertoken.mint('loopagent').token);
  assert.equal(ok.json.recorded, true, 'CONTROL: the harness did not reach the route: ' + JSON.stringify(ok.json));
  store.writeProfile('netagent', { displayName: 'Net' });
  const net = await startFrom('192.0.2.44', sendertoken.mint('netagent').token);
  assert.equal(net.status, 200, JSON.stringify(net.json));
  assert.equal(net.json.recorded, false, 'a network caller started a session: ' + JSON.stringify(net.json));
  assert.equal(net.json.because, 'we could not match that to one of your agents');
  assert.notEqual(liveness.alive('netagent'), true, 'a network caller beat liveness');
});
