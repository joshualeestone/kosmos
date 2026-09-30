'use strict';

/**
 * #4607: POST /api/agent/<name>/codex-hooks is the PERSON's only (trusting Codex hooks lets them run outside the
 * sandbox). On an enforcing board: an agent token alone is refused at the board-token gate; an agent token with the
 * board token is refused by the person-only check (in the header or in the body); a caller with the board token and
 * no browser headers (a process) is refused; the person's page reaches the handler (the CONTROL that the refusals are
 * the route's, not a missing route). The keys themselves are pinned in engine/chat.codex-hooks-4607.test.js.
 *
 * Same harness as server.agent-token-gate-4491.test.js: the board boots fully sandboxed, then enforcement is
 * flipped on in memory.
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-codexhooks-4607-'));
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
const chat = require('./engine/chat');
const status = require('./engine/status');
const fleet = require('./test-support/fleet');
const MENU = fs.readFileSync(path.join(__dirname, 'test-support', 'codex-screens', 'hook-review-menu-0.149.1.txt'), 'utf8');
const IDLE_SCREEN = '› Ask Codex to do anything\n  gpt-5.6-sol default · ~/projects/newsletter';

const BOARD = 'BOARDTOKEN_test_4607_0123456789abcdef';
const GATE_REFUSAL = /this board belongs to the account that started it/;
const PERSON_ONLY = /only you can answer this, from the board/;
const ROUTE = '/api/agent/sam/codex-hooks';
let base;
let agentToken;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
  boardAuthState.on = true;
  boardAuthState.token = BOARD;
  const minted = sendertoken.mint('sam');
  assert.ok(minted.ok, 'could not mint an agent token for the test: ' + minted.because);
  agentToken = minted.token;
});
test.after(() => {
  boardAuthState.on = false;
  try { server.close(); } catch { /* best effort */ }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

async function call(headers, body) {
  const res = await fetch(base + ROUTE, {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),   // a route that throws must fail fast, not at the server's 300s
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => '');
  let json = null; try { json = JSON.parse(text); } catch { json = null; }
  return { code: res.status, text, json };
}
const PAGE = () => ({ 'x-kosmos-board-token': BOARD, 'sec-fetch-site': 'same-origin', origin: base });

test('#4607 an agent token alone never reaches the route (refused at the board-token gate)', async () => {
  const r = await call({ 'x-kosmos-agent-token': agentToken }, { choice: 'trust' });
  assert.equal(r.code, 403);
  assert.match(r.text, GATE_REFUSAL);
});

test('#4607 an agent token with the board token is refused as not the person (header and body)', async () => {
  const header = await call({ ...PAGE(), 'x-kosmos-agent-token': agentToken }, { choice: 'trust' });
  assert.equal(header.code, 403, header.text);
  assert.match(header.text, PERSON_ONLY);
  const inBody = await call(PAGE(), { choice: 'trust', token: agentToken });
  assert.equal(inBody.code, 403, inBody.text);
  assert.match(inBody.text, PERSON_ONLY);
});

test('#4607 a process with the board token and no browser headers is refused', async () => {
  const r = await call({ 'x-kosmos-board-token': BOARD }, { choice: 'skip' });
  assert.equal(r.code, 403, r.text);
  assert.match(r.text, PERSON_ONLY);
});

test('#4607 CONTROL: the person\'s page reaches the handler (a bad choice is a 400, a real one is answered)', async () => {
  const bad = await call(PAGE(), { choice: '2' });
  assert.equal(bad.code, 400, bad.text);
  assert.match(bad.text, /trust the hooks or to continue without them/);
  // No such Codex agent on this sandboxed board: answered, not pressed, and not refused as not the person.
  const real = await call(PAGE(), { choice: 'trust' });
  assert.equal(real.code, 200, real.text);
  assert.equal(real.json && real.json.ok, false);
  assert.doesNotMatch(real.text, PERSON_ONLY);
});

/* End to end through the real server, with chat's tmux scripted: the thread serves what the screen says, and the
   person's answer presses exactly the measured key. This is also the only place that proves the thread route can
   compute codexHooks at all (a missing import there throws only when a Codex agent is asking). */
function scriptedCodex(screens) {
  const keys = [];
  chat.setRunner((args) => {
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
    if (args[0] === 'capture-pane') return { ran: true, spawnFailed: false, status: 0, out: screens.length ? screens.shift() : IDLE_SCREEN, err: '' };
    if (args[0] === 'send-keys') keys.push(args[args.length - 1]);
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  });
  chat.setDryRun(false);
  chat.setPauser(() => {});
  return keys;
}

test('#4607 the thread tells the page what the hook dialog says, and the person\'s Trust presses "2"', async () => {
  const board = fleet.install([fleet.agent('sam', { state: 'needs_you', runner: 'codex', command: 'node', screen: MENU })]);
  try {
    assert.ok(status.codexHookReview(MENU), 'fixture: the menu is the dialog');
    scriptedCodex([MENU, MENU, MENU, MENU]);
    const thread = await fetch(base + '/api/agent/sam/thread', { headers: PAGE(), signal: AbortSignal.timeout(10000) });
    const body = await thread.json();
    assert.equal(thread.status, 200, JSON.stringify(body).slice(0, 200));
    assert.deepEqual(body.codexHooks, { screen: 'menu', count: 2, events: [], source: null });
    const keys = scriptedCodex([MENU, MENU, IDLE_SCREEN]);
    const r = await call(PAGE(), { choice: 'trust' });
    assert.equal(r.code, 200, r.text);
    assert.equal(r.json.ok, true, r.text);
    assert.deepEqual(keys, ['2']);
  } finally {
    board.restore();
    chat.resetForTests();
  }
});
