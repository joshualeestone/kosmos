'use strict';
require('./test-support/tmpscope');   // first: every temp dir this file makes is swept at exit (#4273)

/**
 * #5959 slice 4: GET /api/diagnostics, the file a person saves from Settings > Advanced. On a board that enforces its
 * token it answers only the board token (not an agent's own token: the file carries every agent's lines), as a JSON
 * download, redacted. Harness from server.agent-reads-4491.test.js.
 *
 *   node --test server.diagnostics-5959.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-diag-5959-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');

const { start, server, boardAuthState } = require('./server');
const sendertoken = require('./engine/sendertoken');
const logring = require('./engine/logring');

const BOARD = 'BOARDTOKEN_test_5959_diag_0123456789abcdef';
let base;
let agentToken;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
  boardAuthState.on = true;
  boardAuthState.token = BOARD;
  const a = sendertoken.mint('diag-agent');
  assert.ok(a.ok, 'could not mint the agent token for the test');
  agentToken = a.token;
});
test.after(() => {
  try { server.closeAllConnections(); server.close(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

async function get(headers) {
  const res = await fetch(base + '/api/diagnostics', { headers: headers || {}, redirect: 'manual' });
  return { code: res.status, headers: res.headers, text: await res.text() };
}

test('#5959: the diagnostics file needs the board token; an agent\'s own token is not enough', async () => {
  assert.equal((await get()).code, 403, 'no credential');
  assert.equal((await get({ 'x-kosmos-agent-token': agentToken })).code, 403, 'an agent token alone');
  assert.equal((await get({ 'x-kosmos-board-token': BOARD })).code, 200, 'CONTROL: the board token is answered');
});

test('#5959: it is a JSON download of the file, and a line the board wrote is in it, redacted', async () => {
  // A line in the board's ring, as the board's own write would put it there (the tap is wired only when server.js is
  // the board, so this test taps a stand-in stream into the same ring).
  const home = os.homedir();
  const stand = { write() { return true; } };
  logring.board.tap(stand, 'stdout');
  stand.write(`diagnostics probe 5959 read ${home}/secret-notes\n`);
  const r = await get({ 'x-kosmos-board-token': BOARD });
  assert.equal(r.code, 200);
  assert.match(r.headers.get('content-type') || '', /^application\/json/);
  assert.match(r.headers.get('content-disposition') || '', /^attachment; filename="kosmos-diagnostics-\d{4}-\d{2}-\d{2}\.json"$/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const file = JSON.parse(r.text);
  assert.equal(file.kosmosDiagnostics, 1);
  assert.ok(Array.isArray(file.agents));
  assert.equal(file.log.source, 'since this board started', 'a test board has no board.log of its own');
  const probe = file.log.tail.find((e) => /diagnostics probe 5959/.test(e.line));
  assert.ok(probe, 'CONTROL: the line the board wrote is in the file');
  assert.equal(probe.line, 'diagnostics probe 5959 read ~/secret-notes');
  assert.ok(!r.text.includes(home), 'the home folder is not in the bytes sent');
});

test('#5959: the page\'s ?check=1 look answers 204 with no file, behind the same gate', async () => {
  const look = await fetch(base + '/api/diagnostics?check=1', { headers: { 'x-kosmos-board-token': BOARD } });
  assert.equal(look.status, 204);
  assert.equal(await look.text(), '');
  assert.equal(look.headers.get('content-disposition'), null, 'no file in a look');
  assert.equal((await fetch(base + '/api/diagnostics?check=1')).status, 403, 'CONTROL: the gate still refuses no credential');
});

test('#5959: the download is never sniffed or run as a page', async () => {
  const r = await fetch(base + '/api/diagnostics', { headers: { 'x-kosmos-board-token': BOARD } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('content-security-policy') || '', /sandbox/);
});
