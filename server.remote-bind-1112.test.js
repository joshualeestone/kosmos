'use strict';
/**
 * #1112 phase 2: the network bind, the auth that makes opening it safe, and
 * loopback-only remote token issuance.
 *
 * 🛑 THE ONE PROPERTY THAT MATTERS: owning the network does not own the Mac. A
 * remote (non-loopback) peer may reach ONLY the token-gated agent surface
 * (/api/report, /api/reply) with a valid token; every dangerous write, above
 * all POST /api/agents (which installs a launchd job), stays loopback-only
 * whether the bind is open or not.
 *
 * A real remote socket peer is not reachable from a same-machine test -- every
 * local connection IS loopback -- so `remoteWriteGuard` (which IS the security
 * decision) is exported and driven as a pure function with synthetic peers, and
 * every arm is asserted against a CONTROL that can return the dangerous answer.
 * The issuance ROUTE is driven end-to-end through the real server on loopback,
 * which also confirms a loopback POST reaches the route the guard is meant to
 * let through.
 *
 *   node --test server.remote-bind-1112.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const FAKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rb-home-'));
process.env.HOME = FAKE_HOME;
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rb-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rb-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rb-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rb-launch-'));
// This suite boots the real board, and fixture-discipline requires any suite
// touching the agent surface to sandbox Claude Code's own config file too, so a
// boot never writes trust entries into the operator's real ~/.claude.json.
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(FAKE_HOME, 'claude.json');
// The bind must default to loopback with no opt-in set: assert that here so the
// integration boot below is genuinely testing the default path.
delete process.env.KOSMOS_BIND_HOST;

const { start, server, remoteWriteGuard, isLoopbackPeer, bindHost, REMOTE_AGENT_ROUTES } = require('./server');
const sendertoken = require('./engine/sendertoken');
const store = require('./engine/store');

/** A synthetic request. `peer` is the socket's remoteAddress; default is a
 *  routable public address, i.e. NOT loopback. */
function req(method, { peer = '203.0.113.7', token } = {}) {
  const headers = {};
  if (token !== undefined) headers['x-kosmos-agent-token'] = token;
  return { method, socket: { remoteAddress: peer }, headers };
}
const REMOTE = '203.0.113.7';           // TEST-NET-3, never loopback
const LOOPBACKS = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

/* ---------- the core containment property ---------- */

test('🛑 a remote peer CANNOT reach POST /api/agents; a loopback peer can (the control)', () => {
  const refused = remoteWriteGuard(req('POST', { peer: REMOTE }), '/api/agents');
  assert.ok(refused, 'a remote peer was NOT refused at POST /api/agents -- owning the network would own the Mac');
  // CONTROL: the identical call from loopback must PASS the guard, or the
  // refusal above proves only that the guard refuses everything.
  const local = remoteWriteGuard(req('POST', { peer: '127.0.0.1' }), '/api/agents');
  assert.equal(local, null, 'a loopback peer was refused at POST /api/agents; the control cannot reach the route it is meant to');
});

test('a remote agent reaches /api/report only with a VALID token, and refusals are one sentence (non-oracle)', () => {
  const good = sendertoken.mint('winbox');
  assert.equal(good.ok, true, 'mint failed: ' + good.because);

  const noTok  = remoteWriteGuard(req('POST', { peer: REMOTE }), '/api/report');
  const badTok = remoteWriteGuard(req('POST', { peer: REMOTE, token: 'ab'.repeat(32) }), '/api/report');
  const okTok  = remoteWriteGuard(req('POST', { peer: REMOTE, token: good.token }), '/api/report');
  // route-not-on-allowlist, with a VALID token, so the refusal cannot be about the token:
  const wrongRoute = remoteWriteGuard(req('POST', { peer: REMOTE, token: good.token }), '/api/agents');

  assert.ok(noTok, 'a remote report with NO token was allowed');
  assert.ok(badTok, 'a remote report with an UNKNOWN token was allowed');
  assert.equal(okTok, null, 'a remote report with a VALID token was refused');
  assert.equal(noTok, badTok, 'no-token and bad-token refusals differ: that is a token-validity oracle');
  assert.equal(noTok, wrongRoute, 'wrong-route and bad-token refusals differ: that is a route-existence oracle');
});

test('a remote agent reaches /api/reply only with a valid token', () => {
  const good = sendertoken.mint('winbox-reply');
  assert.ok(remoteWriteGuard(req('POST', { peer: '198.51.100.9' }), '/api/reply'), 'no-token remote reply was allowed');
  assert.equal(remoteWriteGuard(req('POST', { peer: '198.51.100.9', token: good.token }), '/api/reply'), null,
    'a valid-token remote reply was refused');
});

test('a loopback peer is unaffected on EVERY route (the guard changes nothing locally)', () => {
  const routes = [['POST', '/api/agents'], ['POST', '/api/report'], ['GET', '/api/status'],
    ['PUT', '/avatar'], ['POST', '/api/agent-token'], ['DELETE', '/api/connections/x'], ['POST', '/api/msg']];
  for (const [m, p] of routes) {
    for (const peer of LOOPBACKS) {
      assert.equal(remoteWriteGuard(req(m, { peer }), p), null, `loopback ${peer} was refused at ${m} ${p}`);
    }
  }
});

test('an undefined socket peer fails CLOSED (treated as remote)', () => {
  assert.equal(isLoopbackPeer({ socket: {} }), false, 'a socket with no remoteAddress read as loopback');
  assert.ok(remoteWriteGuard({ method: 'POST', socket: {}, headers: {} }, '/api/agents'),
    'an undefined-peer request to /api/agents was allowed');
});

test('the remote allowlist is exactly report + reply, nothing else', () => {
  assert.deepEqual([...REMOTE_AGENT_ROUTES].sort(), ['POST /api/report', 'POST /api/reply'].sort());
});

/* ---------- the bind opt-in ---------- */

test('bindHost defaults to loopback and opens ONLY on an explicit opt-in', () => {
  const saved = process.env.KOSMOS_BIND_HOST;
  try {
    delete process.env.KOSMOS_BIND_HOST;
    assert.equal(bindHost(), '127.0.0.1', 'the default bind is not loopback');
    process.env.KOSMOS_BIND_HOST = '0.0.0.0';
    assert.equal(bindHost(), '0.0.0.0', 'the opt-in bind host was not honoured');
    process.env.KOSMOS_BIND_HOST = '   ';   // whitespace-only is not an opt-in
    assert.equal(bindHost(), '127.0.0.1', 'a blank KOSMOS_BIND_HOST opened the bind');
  } finally {
    if (saved === undefined) delete process.env.KOSMOS_BIND_HOST; else process.env.KOSMOS_BIND_HOST = saved;
  }
});

/* ---------- issuance, end to end on the real server (loopback) ---------- */

let base;
test('boot the board on the default loopback bind', async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

test('POST /api/agent-token mints a resolvable token, from loopback', async () => {
  const name = 'remote-mara';
  // CONTROL: nothing resolves this name before the mint, so a pass below cannot
  // be a stale-store artefact.
  const before = sendertoken.keys().includes(store.safeKey(name));
  assert.equal(before, false, 'the store already knew this name before issuance');

  const res = await fetch(`${base}/api/agent-token`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
  });
  const j = await res.json();
  assert.equal(res.status, 200);
  assert.equal(j.issued, true, 'issuance refused: ' + (j.because || j.error));
  assert.match(j.token, /^[0-9a-f]{64}$/, 'the issued token is not the 32-byte hex the surface validates');

  const back = sendertoken.resolveName(j.token);
  assert.equal(back.ok, true, 'the issued token does not resolve in the store');
  assert.equal(back.key, store.safeKey(name), 'the issued token resolves to the wrong agent');
});

test('POST /api/agent-token refuses an empty name', async () => {
  const res = await fetch(`${base}/api/agent-token`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '   ' }),
  });
  assert.equal(res.status, 400);
});

test.after(() => { try { server.close(); } catch { /* best effort */ } });
