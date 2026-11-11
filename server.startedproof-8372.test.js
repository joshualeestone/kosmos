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

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const liveness = require('./engine/liveness');

test.before(async () => { await start(0); });
test.after(() => {
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
  const tok = sendertoken.mint('coldagent').token;
  const r = await report({ state: 'working', auto: true }, tok);
  assert.equal(r.json.recorded, false);
  assert.equal(r.json.because, 'we could not match that to one of your agents');
});

test('kosmos#8372: a start on a token that is not held (never issued, or retired) is refused exactly as before', async (t) => {
  board(t);
  const never = await report({ state: 'started', auto: true }, 'ab'.repeat(32));
  assert.equal(never.json.recorded, false);
  assert.equal(never.json.because, 'we could not match that to one of your agents');
  const m = sendertoken.mint('goneagent');
  sendertoken.revoke('goneagent');
  const gone = await report({ state: 'started', auto: true }, m.token);
  assert.equal(gone.json.recorded, false, 'a revoked token started a session: ' + JSON.stringify(gone.json));
  assert.equal(liveness.alive('goneagent'), null, 'a refused start beat liveness');
});
