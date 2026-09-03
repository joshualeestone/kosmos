'use strict';

/**
 * #1946: the board-auth token gate, wired into the real request dispatch.
 *
 * The pure decision is pinned in `engine.boardauth-1946.test.js`. This proves the
 * SERVER actually calls it, with the right exempt set, and translates the result
 * into a real HTTP response (403 / 302-bootstrap / proceed) over a real socket.
 *
 * The board is booted FULLY SANDBOXED (so requiring server.js is safe and writes
 * nothing to a real store), then enforcement is flipped on in memory via the
 * exported `boardAuthState` -- a fully-sandboxed board cannot otherwise reach the
 * enforcing path, and booting a non-sandboxed board in a test would touch the
 * operator's real Application Support. This is the same "drive the security
 * decision directly" posture the remote-bind test uses.
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-boardauth-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server, boardAuthState } = require('./server');

const TOK = 'BOARDTOKEN_test_0123456789abcdef';
let base;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  // The board booted fully-sandboxed, so enforcement is OFF. Confirm that (the
  // zero-churn property), then flip it on for the rest of this file.
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce (this is what keeps the suite green)');
  boardAuthState.on = true;
  boardAuthState.token = TOK;
});

async function hit(p, { headers = {} } = {}) {
  const res = await fetch(base + p, { headers, redirect: 'manual' });
  await res.text().catch(() => {});
  return { code: res.status, loc: res.headers.get('location'), setCookie: res.headers.get('set-cookie') };
}

test('an enforcing board REFUSES a request with no token (the dangerous answer, refused)', async () => {
  assert.equal((await hit('/api/status')).code, 403);
});

test('an enforcing board refuses a WRONG token', async () => {
  assert.equal((await hit('/api/status', { headers: { 'x-kosmos-board-token': 'nope' } })).code, 403);
});

test('the static shell (/) stays public -- no account data, so the install flow and healthy() need no token', async () => {
  const r = await hit('/');
  assert.notEqual(r.code, 403, 'the app shell carries no account data and must stay reachable');
  assert.notEqual(r.code, 302, 'a bare / with no query token is not a bootstrap');
});

test('a static icon stays public (the install page probes it to detect the board)', async () => {
  assert.equal((await hit('/icons/kosmos-16.png')).code, 200);
});

test('a valid header token PROCEEDS past the guard', async () => {
  const r = await hit('/api/status', { headers: { 'x-kosmos-board-token': TOK } });
  assert.notEqual(r.code, 403, 'valid token must not be refused');
  assert.notEqual(r.code, 302, 'a header token needs no cookie bootstrap');
});

test('a valid cookie token PROCEEDS past the guard', async () => {
  const r = await hit('/api/status', { headers: { cookie: `kosmos_board=${TOK}` } });
  assert.notEqual(r.code, 403);
  assert.notEqual(r.code, 302);
});

test('a valid ?token= on a GET nav BOOTSTRAPS: 302, cookie set, token stripped from the URL', async () => {
  const r = await hit(`/?first-run=1&token=${TOK}`);
  assert.equal(r.code, 302);
  assert.equal(r.loc, '/?first-run=1', 'the redirect drops the token and keeps other params');
  assert.match(r.setCookie || '', /kosmos_board=/);
  assert.match(r.setCookie || '', /HttpOnly/);
});

test('a WRONG ?token= on a SENSITIVE route is refused, not bootstrapped', async () => {
  // On the exempt shell a wrong ?token just serves the shell; the refusal is on
  // the sensitive surface, so assert it there.
  assert.equal((await hit(`/api/status?token=wrong`)).code, 403);
});

test('a valid ?token= on a GET is not refused (it bootstraps: 302 + cookie)', async () => {
  const r = await hit(`/api/status?token=${TOK}`);
  assert.notEqual(r.code, 403, 'a valid query token is never a refusal');
  assert.equal(r.code, 302, 'a valid ?token= on a GET sets the cookie and redirects');
});

test('the remote agent surface stays reachable without a board token (its own auth)', async () => {
  // POST /api/report is a REMOTE_AGENT_ROUTE, exempt from the board token. It has
  // its own agent-token auth downstream, so the board-token guard must not 403 it.
  const res = await fetch(base + '/api/report', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', redirect: 'manual',
  });
  await res.text().catch(() => {});
  assert.notEqual(res.status, 403, 'board-token guard must exempt the remote agent surface');
});

test.after(() => {
  try { server.close(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});
