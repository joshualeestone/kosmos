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

const { start, server, boardAuthState } = require('./server');
const messagesEngine = require('./engine/messages');
const selfreport = require('./engine/selfreport');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const toolloop = require('./engine/toolloop');

/* The late-digest window (toolloop.LATE_MS) is a real-time 2 s; these requests cross a turn end in milliseconds. */
test.before(async () => { toolloop.setLateMsForTests(0); await start(0); });
test.after(() => {
  server.closeAllConnections(); server.close();
  for (const d of [SANDBOX, process.env.HOME]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

async function postReport(body, headers) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/report`, {
    method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
/* The pane arm, as server.agent-writes-4491.test.js stubs it: tmux is not running in the suite. */
function paneIs(t, map) {
  const real = messagesEngine.resolveSender;
  messagesEngine.resolveSender = (pane, roster) => {
    const card = map[pane] && roster.find((c) => c.sessionName === map[pane]);
    return card ? { ok: true, card } : { ok: false, because: 'no such pane' };
  };
  t.after(() => { messagesEngine.resolveSender = real; });
}

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

test('an automatic idle through /api/report ends the turn, even over a standing deliberate needs_you', async (t) => {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' })]);
  t.after(() => board.restore());
  toolloop.forget('leo');
  const tok = sendertoken.mint('leo').token;
  const h = { 'x-kosmos-agent-token': tok };
  for (let i = 0; i < 3; i++) await postFail({ tool: 'Bash', sig: SIG, error: 'e' }, h);
  selfreport.record('leo', { state: 'needs_you', because: 'which database?' });   // the agent's own question, deliberate
  const idle = await postReport({ state: 'idle', auto: true, text: 'finished responding' }, h);
  assert.equal(idle.json.recorded, false, 'the guard refuses an automatic idle over a deliberate needs_you: ' + JSON.stringify(idle.json));
  assert.equal(toolloop.peek('leo').turnOver, true, 'the turn ended all the same');
  const next = await postFail({ tool: 'Bash', sig: SIG, error: 'e' }, h);
  assert.equal(next.json.count, 1, 'the same failure in the next turn is a new run');
  const working = await postReport({ state: 'working', auto: true, text: 'running Bash' }, h);
  assert.ok(working.status === 200);
  assert.equal((await postFail({ tool: 'Bash', sig: SIG, error: 'e' }, h)).json.count, 2, 'a working report does not end a turn');
  const deliberate = await postReport({ state: 'idle', text: 'done' }, h);
  assert.ok(deliberate.status === 200);
  assert.equal((await postFail({ tool: 'Bash', sig: SIG, error: 'e' }, h)).json.count, 3, 'only an AUTOMATIC idle (the Stop hook) ends a turn');
});

test('the pane arm names the agent on a board that does not enforce', async (t) => {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('mara', { state: 'idle' })]);
  t.after(() => board.restore());
  paneIs(t, { '%8': 'mara' });
  toolloop.forget('mara'); toolloop.forget('leo');
  const r = await postFail({ tool: 'Read', sig: SIG, error: 'File does not exist.', from_pane: '%8' });
  assert.equal(r.json.recorded, true, JSON.stringify(r.json));
  assert.equal(toolloop.peek('mara').tool, 'Read');
  assert.equal(toolloop.peek('leo'), null);
  assert.equal((await postFail({ tool: 'Read', sig: SIG, from_pane: '%99' })).json.recorded, false, 'a pane that names nobody');
});

test('an enforcing board refuses a bare pane, and takes the board token or an agent token', async (t) => {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' })]);
  paneIs(t, { '%8': 'leo' });
  const BOARD = 'BOARDTOKEN_6071_0123456789abcdef';
  const was = { on: boardAuthState.on, token: boardAuthState.token };
  boardAuthState.on = true; boardAuthState.token = BOARD;
  t.after(() => { boardAuthState.on = was.on; boardAuthState.token = was.token; board.restore(); });
  toolloop.forget('leo');
  const bare = await postFail({ tool: 'Bash', sig: SIG, from_pane: '%8' });
  assert.notEqual(bare.json && bare.json.recorded, true, 'a bare pane on an enforcing board must not record: ' + bare.status + ' ' + JSON.stringify(bare.json));
  assert.equal(toolloop.peek('leo'), null);
  const withBoard = await postFail({ tool: 'Bash', sig: SIG, from_pane: '%8' }, { 'x-kosmos-board-token': BOARD });
  assert.equal(withBoard.json.recorded, true, JSON.stringify(withBoard.json));
  const withAgent = await postFail({ tool: 'Bash', sig: SIG }, { 'x-kosmos-agent-token': sendertoken.mint('leo').token });
  assert.equal(withAgent.json.recorded, true, JSON.stringify(withAgent.json));
  assert.equal(toolloop.peek('leo').count, 2);
});

test('reaching the threshold is logged once per run, and only then', async (t) => {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' })]);
  t.after(() => board.restore());
  toolloop.forget('leo');
  const tok = sendertoken.mint('leo').token;
  const lines = [];
  const real = console.log;
  console.log = (...a) => { const l = a.join(' '); if (l.includes('[toolloop]')) lines.push(l); else real.apply(console, a); };
  try {
    for (let i = 0; i < toolloop.LOOP_AT + 3; i++) await postFail({ tool: 'Bash', sig: SIG, error: 'e' }, { 'x-kosmos-agent-token': tok });
  } finally { console.log = real; }
  assert.equal(lines.length, 1, JSON.stringify(lines));
  assert.match(lines[0], /leo: Bash failed the same way 5 times in one turn/);
});

test('a body over the route\'s small limit is refused, not buffered', async (t) => {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' })]);
  t.after(() => board.restore());
  toolloop.forget('leo');
  /* readBody over its limit either answers 400 or drops the connection; both are a refusal. */
  let status = null;
  try { status = (await postFail({ tool: 'Bash', sig: SIG, error: 'x'.repeat(20000) }, { 'x-kosmos-agent-token': sendertoken.mint('leo').token })).status; }
  catch { status = 'dropped'; }
  assert.ok(status === 400 || status === 413 || status === 'dropped', String(status));
  assert.equal(toolloop.peek('leo'), null, 'nothing recorded');
});

test('the next prompt ends a turn too, as when the person pressed Esc and no Stop came', async (t) => {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' })]);
  t.after(() => board.restore());
  toolloop.forget('leo');
  const h = { 'x-kosmos-agent-token': sendertoken.mint('leo').token };
  for (let i = 0; i < 3; i++) await postFail({ tool: 'Bash', sig: SIG, error: 'e' }, h);
  await postReport({ state: 'working', auto: true, text: toolloop.PROMPT_TEXT }, h);
  assert.equal((await postFail({ tool: 'Bash', sig: SIG, error: 'e' }, h)).json.count, 1);
});
