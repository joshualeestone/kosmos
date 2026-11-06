'use strict';
require('./test-support/tmpscope');

/**
 * kosmos#8109: the removal routes take the name `kosmos agent list` prints (an agent's display name, "Cai") and act
 * on the one agent it names (folder `cai`), through the real routes rather than the engine alone. Harness as
 * server.agent-remove-4475.test.js: a fully sandboxed board, DRY_RUN, enforcement flipped on in memory.
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agentremove-8109-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');

const { start, server, boardAuthState } = require('./server');
const create = require('./engine/create');
const fleet = require('./test-support/fleet');

const BOARD = 'BOARDTOKEN_test_8109_0123456789abcdef';
let base;
let board;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  boardAuthState.on = true;
  boardAuthState.token = BOARD;
  board = fleet.install([]);
});

/* An agent as create makes one: its folder, its instruction file (where its display name comes from) and its profile
   (kosmos#8113: the list, and so name resolution, knows an agent by its profile, not by a bare folder). */
function folderAgent(dir, displayName) {
  fs.mkdirSync(create.workerDir(dir), { recursive: true });
  fs.writeFileSync(path.join(create.workerDir(dir), 'CLAUDE.md'), `You are **${displayName}**.\n`, 'utf8');
  require('./engine/store').writeProfile(dir, {});
}
const RESOLVE = '?resolve=1';   // what both CLIs send on the plan; the board's own button does not
async function call(method, name, query = '') {
  const res = await fetch(`${base}/api/agent/${encodeURIComponent(name)}/removal${query}`,
    { method, redirect: 'manual', headers: { 'x-kosmos-board-token': BOARD } });
  const text = await res.text().catch(() => '');
  let json = null; try { json = JSON.parse(text); } catch { json = null; }
  return { code: res.status, text, json };
}

test('CONTROL: a name no agent has is refused as not found, spelled as asked', async () => {
  const r = await call('GET', 'Nobody8109');
  assert.equal(r.code, 400, r.text.slice(0, 160));
  assert.match(r.text, /cannot find an agent called Nobody8109/);
});

test('the plan route takes the display name agent list prints, and names the agent it resolved', async () => {
  folderAgent('kroute8109', 'Kroute8109');
  const r = await call('GET', 'Kroute8109', RESOLVE);
  assert.equal(r.code, 200, 'the listed display name was not planned: ' + r.text.slice(0, 200));
  assert.equal(r.json && r.json.name, 'kroute8109', 'the plan did not resolve to the agent it names');
});

test('the board asks about its own card by exact name (no resolve=1) and is never answered with another agent', async () => {
  folderAgent('kcard8109', 'Kcard8109');
  const board = await call('GET', 'Kcard8109');
  assert.equal(board.code, 400, 'a plan without resolve=1 was resolved to another agent: ' + board.text.slice(0, 200));
  assert.match(board.text, /cannot find an agent called Kcard8109/);
  assert.equal((await call('GET', 'Kcard8109', RESOLVE)).json.name, 'kcard8109', 'CONTROL: with resolve=1 it does resolve');
});

test('the plan names the agent, and the remove route removes it by that name (what both CLIs send)', async () => {
  folderAgent('kgone8109', 'Kgone8109');
  const p = await call('GET', 'Kgone8109', RESOLVE);
  assert.equal(p.json && p.json.name, 'kgone8109', 'CONTROL: the plan did not resolve the listed name');
  const r = await call('DELETE', p.json.name);
  assert.equal(r.code, 200, 'the resolved name was not removed: ' + r.text.slice(0, 200));
  assert.equal(r.json && r.json.outcome, 'removed', r.text.slice(0, 200));
});

test('a DELETE whose agent is gone is not redirected to another agent with that display name', async () => {
  // The board's button sends the card's exact name. If that agent went away after the question was asked, the
  // removal must not land on a different agent whose display name happens to match.
  folderAgent('kother8109', 'Kmax8109');
  const r = await call('DELETE', 'Kmax8109');
  assert.equal(r.code, 400, 'a DELETE for a missing agent removed another one: ' + r.text.slice(0, 200));
  assert.match(r.text, /cannot find an agent called Kmax8109/, r.text.slice(0, 200));
  // CONTROL: the redirect was possible, since the plan resolves that same name to the other agent.
  const p = await call('GET', 'Kmax8109', RESOLVE);
  assert.equal(p.json && p.json.name, 'kother8109', 'CONTROL: the name does not resolve to the other agent, so this test proves nothing');
});

test('a name two agents answer to is refused by the plan, naming each folder with the name it is shown by', async () => {
  folderAgent('ktwin8109a', 'Ktwin 8109');
  folderAgent('ktwin8109b', 'Ktwin 8109');
  const p = await call('GET', 'Ktwin 8109', RESOLVE);
  assert.equal(p.code, 400, p.text.slice(0, 160));
  assert.match(p.text, /more than one agent is called Ktwin 8109 \(ktwin8109a, shown as Ktwin 8109; ktwin8109b, shown as Ktwin 8109\)/,
    p.text.slice(0, 220));
});

test('a card outside the folder: a session-only agent shown as X plus a folder shown as X is refused as ambiguous', async () => {
  // Round 7: `agent list` prints every card, and a card whose agent has no folder in the workers folder (here a live
  // session whose display name comes from its profile) must count, or the folder agent is removed with no refusal.
  folderAgent('ksrv8109', 'Ksrv8109');
  const store = require('./engine/store');
  store.writeProfile('kcon8109', { displayName: 'Ksrv8109' });
  board.restore();
  board = fleet.install([fleet.agent('kcon8109', { ours: 'claim' })], { strict: false });
  try {
    assert.equal(board.card('kcon8109').name, 'Ksrv8109', 'CONTROL: the board does not show the session agent as Ksrv8109');
    const p = await call('GET', 'Ksrv8109', RESOLVE);
    assert.equal(p.code, 400, 'a name a session agent also answers to was resolved to the folder agent: ' + p.text.slice(0, 200));
    assert.match(p.text, /more than one agent is called Ksrv8109 \(kcon8109, shown as Ksrv8109; ksrv8109, shown as Ksrv8109\)/, p.text.slice(0, 220));
  } finally {
    board.restore();
    board = fleet.install([]);
  }
  // CONTROL: with the session gone, the same name resolves to the folder agent, so the test can see the miss.
  const c = await call('GET', 'Ksrv8109', RESOLVE);
  assert.equal(c.json && c.json.name, 'ksrv8109', 'CONTROL: the name does not resolve without the session: ' + c.text.slice(0, 200));
});

test('kosmos#8113 the hidden setup guide does not make a listed name ambiguous', async () => {
  const sa = require('./engine/setup-assistant');
  folderAgent('kseen8113', 'Klist8113');
  folderAgent('kguide8113', 'Klist8113');
  fs.writeFileSync(path.join(create.workerDir('kguide8113'), sa.GUIDE_MARKER), 'kguide8113\n');   // what the seed writes
  assert.ok(sa.markSetupAssistantSeeded({ name: 'kguide8113' }), 'CONTROL: the guide was not seeded');
  try {
    assert.equal(sa.isGuideFolder(sa.guideName()), true, 'CONTROL: the board does not see kguide8113 as the guide');
    const p = await call('GET', 'Klist8113', RESOLVE);
    assert.equal(p.code, 200, 'the hidden guide made a listed name ambiguous: ' + p.text.slice(0, 220));
    assert.equal(p.json && p.json.name, 'kseen8113', p.text.slice(0, 200));
  } finally {
    fs.rmSync(path.join(require('./engine/store').ROOT, 'setup-assistant.json'), { force: true });   // where setup-assistant's flagPath writes
  }
  // CONTROL: once kguide8113 is not the guide, the list shows it and the same name is ambiguous.
  const c = await call('GET', 'Klist8113', RESOLVE);
  assert.equal(c.code, 400, 'CONTROL: without the guide mark the name is not ambiguous, so this test proves nothing: ' + c.text.slice(0, 200));
  assert.match(c.text, /more than one agent is called Klist8113/);
});

test.after(() => {
  try { board.restore(); } catch { /* ignore */ }
  try { server.close(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});
