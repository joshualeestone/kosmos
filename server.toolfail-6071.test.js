'use strict';
/* #6071 (slice D1): POST /api/toolfail against the real server. The sender is resolved as POST /api/report resolves
 * it (token first, then pane), and the same failure repeating is counted for that agent only.
 *   node --test server.toolfail-6071.test.js */
require('./test-support/tmpscope'); // this process's temp folders, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-toolfail-6071-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-toolfail-6071-home-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-toolfail-6071-work-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-toolfail-6071-proj-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-toolfail-6071-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const toolloop = require('./engine/toolloop');

test.before(async () => { await start(0); });
test.after(() => {
  server.closeAllConnections(); server.close();
  for (const d of [SANDBOX, process.env.HOME]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

async function postFail(body, headers) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/toolfail`, {
    method: 'POST',
    headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const SIG = 'c'.repeat(64);

test('the same failure from one agent is counted for that agent, and looping from the threshold on', async (t) => {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('mara', { state: 'idle' })]);
  t.after(() => board.restore());
  toolloop.forget('leo'); toolloop.forget('mara');
  const tok = sendertoken.mint('leo').token;
  let r;
  for (let i = 1; i <= toolloop.LOOP_AT; i++) {
    r = await postFail({ tool: 'Bash', sig: SIG, error: 'Exit code 2', from_pane: '' }, { 'x-kosmos-agent-token': tok });
    assert.equal(r.status, 200);
    assert.equal(r.json.recorded, true, JSON.stringify(r.json));
    assert.equal(r.json.count, i);
  }
  assert.equal(r.json.looping, true);
  const p = toolloop.peek('leo');
  assert.equal(p.count, toolloop.LOOP_AT);
  assert.equal(p.tool, 'Bash');
  assert.equal(toolloop.peek('mara'), null, 'another agent is untouched');
});

test('a token that names nobody, or no credential and no pane, records nothing', async (t) => {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' })]);
  t.after(() => board.restore());
  toolloop.forget('leo');
  const spoof = await postFail({ tool: 'Bash', sig: SIG, from_pane: '%3' }, { 'x-kosmos-agent-token': '0'.repeat(64) });
  assert.equal(spoof.json.recorded, false, 'a presented token decides: no fallback to the pane');
  const anon = await postFail({ tool: 'Bash', sig: SIG, from_pane: '' });
  assert.equal(anon.json.recorded, false);
  assert.equal(toolloop.peek('leo'), null);
});

test('a bad signature or an unreadable body is refused, and nothing is written', async (t) => {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' })]);
  t.after(() => board.restore());
  toolloop.forget('leo');
  const tok = sendertoken.mint('leo').token;
  const bad = await postFail({ tool: 'Bash', sig: 'not-hex' }, { 'x-kosmos-agent-token': tok });
  assert.equal(bad.json.recorded, false);
  const junk = await postFail('{ nope', { 'x-kosmos-agent-token': tok });
  assert.equal(junk.status, 400);
  assert.equal(toolloop.peek('leo'), null);
});
