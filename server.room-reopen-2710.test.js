'use strict';
/**
 * kosmos#2710: POST /api/project/:id/room/reopen, over HTTP.
 *
 * The room loop-guard (the valve) holds a room that went back and forth without
 * landing. Before this there was no way to CLEAR that hold except an operator
 * post (which happens to reset the window); this route is the explicit release.
 * The valve SEMANTICS -- a reopen marker moving the window mark so the next post
 * lands -- are proven at the engine level in engine/messages.test.js
 * (#2710: reopening a held room ...). This file proves the ROUTE's own job:
 *   - it maps the path to the project, writes ONE operator reopen marker, and
 *     answers { ok: true };
 *   - an unknown project is a 404, not a silent write;
 *   - OPERATOR-ONLY by construction: it is under /api/, so the sensitive-route
 *     gate demands the BOARD TOKEN, and it is deliberately OUT of
 *     REMOTE_AGENT_ROUTES / LOOPBACK_AGENT_ROUTES. The last test flips
 *     enforcement on and proves a no-token POST is refused (403) while a
 *     token POST is not -- the dangerous answer (an unauthenticated reopen)
 *     refused, with a control that admits the token.
 *
 * Same sandbox posture as server.parts-valve.test.js: boot fully sandboxed
 * (enforcement OFF), then drive real requests over loopback.
 *
 *   node --test server.room-reopen-2710.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-room-reopen-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server, boardAuthState } = require('./server');
const projects = require('./engine/projects');
const messages = require('./engine/messages');

const TOK = 'BOARDTOKEN_test_0123456789abcdef';
let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce (this keeps the functional tests token-free)');
});
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

async function reopen(id, { token } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers['x-kosmos-board-token'] = token;
  const res = await fetch(base + '/api/project/' + encodeURIComponent(id) + '/room/reopen', {
    method: 'POST', headers, redirect: 'manual',
  });
  const text = await res.text().catch(() => '');
  let json = {}; try { json = JSON.parse(text); } catch { /* {} */ }
  return { code: res.status, json, text };
}

test('#2710: the route writes ONE operator reopen marker for the project and answers ok', async () => {
  const p = projects.create({ name: 'Reopen Route' });
  projects.addAgent(p.id, 'april');
  const before = messages.record().rows.filter((m) => m.kind === 'reopen' && m.project === p.id).length;
  const r = await reopen(p.id);
  assert.equal(r.code, 200, r.text);
  assert.equal(r.json.ok, true, 'the route did not answer ok on a real project');
  const rows = messages.record().rows.filter((m) => m.kind === 'reopen' && m.project === p.id);
  assert.equal(rows.length, before + 1, 'the route wrote no reopen marker (or more than one)');
  assert.equal(rows[rows.length - 1].operator, true, 'the reopen marker must be an operator row');
});

test('#2710: an unknown project is a 404 and writes nothing', async () => {
  const before = messages.record().rows.filter((m) => m.kind === 'reopen').length;
  const r = await reopen('no-such-project-xyz');
  assert.equal(r.code, 404, r.text);
  assert.equal(r.json.ok, false, 'a 404 must not answer ok');
  const after = messages.record().rows.filter((m) => m.kind === 'reopen').length;
  assert.equal(after, before, 'a refused reopen still wrote a marker');
});

// LAST: enforcement on. Everything above ran token-free on a non-enforcing
// board; here the board demands the token, so this proves the reopen route did
// NOT accidentally land in an auth-exempt set -- the dangerous answer (an
// unauthenticated reopen) is refused, and a valid token still passes.
test('AUTH: an enforcing board REFUSES a no-token reopen (403) and ADMITS a token reopen', async () => {
  boardAuthState.on = true;
  boardAuthState.token = TOK;
  try {
    const p = projects.create({ name: 'Reopen Auth' });
    const refused = await reopen(p.id);
    assert.equal(refused.code, 403, 'a reopen with no board token must be refused on an enforcing board: ' + refused.text);
    const ok = await reopen(p.id, { token: TOK });
    assert.notEqual(ok.code, 403, 'a valid board token must pass the gate: ' + ok.text);
    assert.equal(ok.json.ok, true, 'a token reopen did not land: ' + ok.text);
  } finally {
    boardAuthState.on = false;
    boardAuthState.token = null;
  }
});
