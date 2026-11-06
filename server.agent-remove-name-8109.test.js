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

/* An agent as a folder and its instruction file, which is where its display name comes from. */
function folderAgent(dir, displayName) {
  fs.mkdirSync(create.workerDir(dir), { recursive: true });
  fs.writeFileSync(path.join(create.workerDir(dir), 'CLAUDE.md'), `You are **${displayName}**.\n`, 'utf8');
}
async function call(method, name) {
  const res = await fetch(`${base}/api/agent/${encodeURIComponent(name)}/removal`,
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
  const r = await call('GET', 'Kroute8109');
  assert.equal(r.code, 200, 'the listed display name was not planned: ' + r.text.slice(0, 200));
  assert.equal(r.json && r.json.name, 'kroute8109', 'the plan did not resolve to the agent it names');
});

test('the remove route takes the display name too, and removes that agent', async () => {
  folderAgent('kgone8109', 'Kgone8109');
  const r = await call('DELETE', 'Kgone8109');
  assert.equal(r.code, 200, 'the listed display name was not removed: ' + r.text.slice(0, 200));
  // Without the resolution this is a 400 "cannot find an agent called Kgone8109" (the CONTROL above shows that shape).
  // DRY_RUN writes no removal record, so whether it is then hidden is shown in engine/remove.test.js instead.
  assert.equal(r.json && r.json.outcome, 'removed', r.text.slice(0, 200));
});

test('a name two agents answer to is refused on both routes, naming both folders', async () => {
  folderAgent('ktwin8109a', 'Ktwin 8109');
  folderAgent('ktwin8109b', 'Ktwin 8109');
  const p = await call('GET', 'Ktwin 8109');
  assert.equal(p.code, 400, p.text.slice(0, 160));
  assert.match(p.text, /more than one agent is called Ktwin 8109 \(ktwin8109a, ktwin8109b\)/, p.text.slice(0, 200));
  const d = await call('DELETE', 'Ktwin 8109');
  assert.equal(d.code, 400, d.text.slice(0, 160));
  assert.equal(d.json && d.json.outcome, 'refused');
  assert.match(d.text, /more than one agent is called/);
});

test.after(() => {
  try { board.restore(); } catch { /* ignore */ }
  try { server.close(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});
