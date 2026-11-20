'use strict';
require('./test-support/tmpscope');

/**
 * kosmos#8839: GET /api/agents/account-plan takes the name `kosmos agent list` prints ("Sub-Zero", "Sonya Blade") to
 * the one agent it names (folder subzero, sonyablade), but ONLY when the caller asks (`?resolve=1`, which both CLIs
 * send), as kosmos#8109 does for agent remove. Measured before the fix on Mortals' board (0.8.12): `kosmos agent move
 * "Sub-Zero" <account> --yes` answered "there is no agent called Sub-Zero", while the id worked. The board is real and
 * sandboxed (the #8109 harness: fake tmux, DRY_RUN); the agents are real folders with display names, so resolution
 * reads the same cards `agent list` prints. Only the Claude accounts and the launch jobs are stubbed, as
 * server.accountplan-8048.test.js stubs them.
 *
 *   node --test server.agent-move-name-8839.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agentmove-8839-'));
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
const HOME = process.env.AGENT_WORKFORCE_HOME;
const MAIN = path.join(HOME, '.claude');
const SPARE = path.join(HOME, '.claude-spare');
for (const d of [MAIN, SPARE]) fs.mkdirSync(d, { recursive: true });

const accounts = require('./engine/accounts');
const create = require('./engine/create');
const REAL = { list: accounts.list, readJob: create.readJob };
accounts.list = () => [{ dir: MAIN, isDefault: true, label: null, apiKey: false }, { dir: SPARE, isDefault: false, label: 'spare', apiKey: false }];
const JOBS = {};
create.readJob = (n) => JOBS[n] || null;

const { start, server, boardAuthState } = require('./server');
const fleet = require('./test-support/fleet');
const BOARD = 'BOARDTOKEN_test_8839_0123456789abcdef';
let base;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  boardAuthState.on = true;
  boardAuthState.token = BOARD;
  fleet.install([]);
});
test.after(() => {
  accounts.list = REAL.list; create.readJob = REAL.readJob;
  server.close(); fs.rmSync(SANDBOX, { recursive: true, force: true });
});

/* An agent as create makes one: its folder, its instruction file (its display name) and its profile (kosmos#8113), and
   a launch job on the main account. */
function agent(dir, displayName) {
  fs.mkdirSync(create.workerDir(dir), { recursive: true });
  fs.writeFileSync(path.join(create.workerDir(dir), 'CLAUDE.md'), `You are **${displayName}**.\n`, 'utf8');
  require('./engine/store').writeProfile(dir, {});
  JOBS[dir] = { configDir: null, runner: 'claude' };
}
async function plan(q) {
  const res = await fetch(`${base}/api/agents/account-plan?${new URLSearchParams(q)}`, { headers: { 'x-kosmos-board-token': BOARD } });
  const text = await res.text().catch(() => '');
  let json = null; try { json = JSON.parse(text); } catch { json = null; }
  return { code: res.status, text, json };
}

test('#8839: with resolve=1, a listed name with a hyphen and one with a space reach their agents, and the plan names them', async () => {
  agent('subzero', 'Sub-Zero');
  agent('sonyablade', 'Sonya Blade');
  const hy = await plan({ name: 'Sub-Zero', account: 'spare', resolve: '1' });
  assert.equal(hy.code, 200, 'the listed name with a hyphen was not planned: ' + hy.text.slice(0, 200));
  assert.equal(hy.json.name, 'subzero', 'the plan did not name the agent it resolved');
  assert.equal(hy.json.dir, SPARE);
  const sp = await plan({ name: 'Sonya Blade', account: 'spare', resolve: '1' });
  assert.equal(sp.code, 200, 'the listed name with a space was not planned: ' + sp.text.slice(0, 200));
  assert.equal(sp.json.name, 'sonyablade');
  // CONTROL: the id still works, resolved or not.
  assert.equal((await plan({ name: 'subzero', account: 'spare', resolve: '1' })).json.name, 'subzero');
  assert.equal((await plan({ name: 'subzero', account: 'spare' })).json.name, 'subzero');
});

test('#8839: without resolve=1 (Settings asks by the exact name) a listed name is NOT resolved, as before', async () => {
  agent('subzero', 'Sub-Zero');
  const r = await plan({ name: 'Sub-Zero', account: 'spare' });
  assert.equal(r.code, 404, 'a plan without resolve=1 was resolved: ' + r.text.slice(0, 200));
  assert.match(r.json.because, /there is no agent called Sub-Zero/);
});

test('#8839: a name two agents answer to is refused and names both, never guessed', async () => {
  agent('twin8839a', 'Twin 8839');
  agent('twin8839b', 'Twin 8839');
  const r = await plan({ name: 'Twin 8839', account: 'spare', resolve: '1' });
  assert.equal(r.code, 409, r.text.slice(0, 200));
  assert.equal(r.json.ambiguous, true);
  assert.match(r.json.because, /more than one agent is called Twin 8839/);
  assert.match(r.json.because, /twin8839a/);
  assert.match(r.json.because, /twin8839b/);
});

test('#8839: a name no agent has is refused as not found, spelled as asked', async () => {
  const r = await plan({ name: 'Nobody 8839', account: 'spare', resolve: '1' });
  assert.equal(r.code, 404, r.text.slice(0, 200));
  assert.match(r.json.because, /there is no agent called Nobody 8839 on this computer/);
});
