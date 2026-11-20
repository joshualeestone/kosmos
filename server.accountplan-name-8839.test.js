'use strict';
require('./test-support/tmpscope');

/**
 * kosmos#8839: GET /api/agents/account-plan takes the name `kosmos agent list` prints ("Sub-Zero", "Sonya Blade") when
 * the caller asks with resolve=1, as both CLIs do, and answers with the agent's own name (subzero, sonyablade), which
 * is what the CLI then sends to the move. Before, the plan looked for a launch job under the typed name alone, so
 * `kosmos agent move "Sub-Zero" <account> --yes` answered "there is no agent called Sub-Zero on this computer".
 * Through the real board, with real folders and cards; only the accounts and the launch jobs are stubbed, as
 * server.accountplan-8048.test.js stubs them. Harness as server.agent-remove-name-8109.test.js.
 *
 *   node --test server.accountplan-name-8839.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-acctplan-name-8839-'));
const HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');

const MAIN = path.join(HOME, '.claude');
const SPARE = path.join(HOME, '.claude-spare');
for (const d of [MAIN, SPARE]) { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'settings.json'), '{}'); }

const accounts = require('./engine/accounts');
const create = require('./engine/create');
const REAL = { list: accounts.list, readJob: create.readJob };
const ROWS = [
  { dir: MAIN, isDefault: true, label: null, apiKey: false },
  { dir: SPARE, isDefault: false, label: 'spare', apiKey: false },
];
/* Launch jobs exist under the agents' own names only, as on a real board: nothing is filed under a display name. */
const JOBS = {
  subzero: { configDir: null, runner: 'claude' },
  sonyablade: { configDir: null, runner: 'claude' },
  twina: { configDir: null, runner: 'claude' },
  twinb: { configDir: null, runner: 'claude' },
};
accounts.list = () => ROWS;
create.readJob = (n) => (Object.prototype.hasOwnProperty.call(JOBS, n) ? JOBS[n] : null);

const { start, server, boardAuthState } = require('./server');
const fleet = require('./test-support/fleet');

const BOARD = 'BOARDTOKEN_test_8839_0123456789abcdef';
let base;

/* An agent as create makes one: its folder, its instruction file (where its display name comes from) and its profile
   (kosmos#8113: the list, and so name resolution, knows an agent by its profile, not by a bare folder). */
function folderAgent(dir, displayName) {
  fs.mkdirSync(create.workerDir(dir), { recursive: true });
  fs.writeFileSync(path.join(create.workerDir(dir), 'CLAUDE.md'), `You are **${displayName}**.\n`, 'utf8');
  require('./engine/store').writeProfile(dir, {});
}

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  boardAuthState.on = true;
  boardAuthState.token = BOARD;
  fleet.install([]);
  folderAgent('subzero', 'Sub-Zero');
  folderAgent('sonyablade', 'Sonya Blade');
});
test.after(() => {
  accounts.list = REAL.list; create.readJob = REAL.readJob;
  server.close(); fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const plan = async (q) => {
  const r = await fetch(`${base}/api/agents/account-plan?${new URLSearchParams(q)}`, { headers: { 'x-kosmos-board-token': BOARD } });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch { j = null; }
  return { code: r.status, j, text };
};

test('kosmos#8839: a listed name with a hyphen (Sub-Zero) is planned as the agent it names, and the answer says which', async () => {
  const r = await plan({ name: 'Sub-Zero', account: 'spare', resolve: '1' });
  assert.equal(r.code, 200, 'the name agent list prints was refused: ' + r.text.slice(0, 200));
  assert.deepEqual([r.j.ok, r.j.name, r.j.shown, r.j.dir], [true, 'subzero', 'Sub-Zero', SPARE], r.text.slice(0, 300));
});

test('kosmos#8839: a listed name with a space (Sonya Blade) is planned as the agent it names, in any letter case', async () => {
  const r = await plan({ name: 'Sonya Blade', account: 'spare', resolve: '1' });
  assert.equal(r.code, 200, 'the name agent list prints was refused: ' + r.text.slice(0, 200));
  assert.deepEqual([r.j.ok, r.j.name, r.j.shown], [true, 'sonyablade', 'Sonya Blade'], r.text.slice(0, 300));
  const lower = await plan({ name: 'sonya blade', account: 'spare', resolve: '1' });
  assert.equal(lower.j && lower.j.name, 'sonyablade', lower.text.slice(0, 200));
  // "Already there" carries the resolved name too, so the CLI names the right agent when nothing moves.
  const same = await plan({ name: 'Sonya Blade', account: 'main', resolve: '1' });
  assert.deepEqual([same.j.ok, same.j.same, same.j.name], [true, true, 'sonyablade'], same.text.slice(0, 300));
});

test('CONTROL: the agent\'s own name still plans, with resolve=1 and without it', async () => {
  // Asserted by what main already answered (code, ok, the folder), so this holds with and without the fix.
  const asked = await plan({ name: 'subzero', account: 'spare', resolve: '1' });
  assert.deepEqual([asked.code, asked.j.ok, asked.j.dir], [200, true, SPARE], asked.text.slice(0, 300));
  const bare = await plan({ name: 'subzero', account: 'spare' });
  assert.deepEqual([bare.code, bare.j.ok, bare.j.dir], [200, true, SPARE], bare.text.slice(0, 300));
});

test('without resolve=1 (Settings, which sends the card\'s own name) a display name is not taken for another agent', async () => {
  const r = await plan({ name: 'Sub-Zero', account: 'spare' });
  assert.equal(r.code, 404, 'a plan without resolve=1 was resolved: ' + r.text.slice(0, 200));
  assert.match(r.j.because, /there is no agent called Sub-Zero on this computer/);
});

test('a name no agent answers to is still refused as no agent, spelled as asked', async () => {
  const r = await plan({ name: 'Nobody Here', account: 'spare', resolve: '1' });
  assert.equal(r.code, 404, r.text.slice(0, 200));
  assert.match(r.j.because, /there is no agent called Nobody Here on this computer/);
});

test('a name two agents are shown by is refused, naming both, and neither is planned', async () => {
  folderAgent('twina', 'Twin Name');
  folderAgent('twinb', 'Twin Name');
  const r = await plan({ name: 'Twin Name', account: 'spare', resolve: '1' });
  assert.equal(r.code, 409, 'an ambiguous name was planned: ' + r.text.slice(0, 300));
  assert.equal(r.j.ok, false);
  assert.equal(r.j.dir, undefined, 'the refusal carried a folder, which a CLI reads as a plan');
  assert.match(r.j.because, /more than one agent is called Twin Name \(twina, shown as Twin Name; twinb, shown as Twin Name\)/);
  // CONTROL: each is still reachable by its own name.
  assert.equal((await plan({ name: 'twina', account: 'spare', resolve: '1' })).j.name, 'twina');
});

test('cards that cannot be read: a listed name is a failed read (503), never "no agent"; the agent\'s own name still plans', async () => {
  const removal = require('./engine/remove');
  const before = fs.existsSync(removal.REMOVED_FILE) ? fs.readFileSync(removal.REMOVED_FILE) : null;
  fs.mkdirSync(path.dirname(removal.REMOVED_FILE), { recursive: true });
  fs.writeFileSync(removal.REMOVED_FILE, '{ not json');
  try {
    const r = await plan({ name: 'Sub-Zero', account: 'spare', resolve: '1' });
    assert.equal(r.code, 503, 'an unread board answered as if it knew: ' + r.text.slice(0, 200));
    assert.deepEqual([r.j.ok, r.j.readFailed, r.j.dir], [false, true, undefined], r.text.slice(0, 200));
    assert.doesNotMatch(r.j.because, /no agent called/);
    assert.equal((await plan({ name: 'subzero', account: 'spare', resolve: '1' })).code, 200, 'the exact name needs no cards');
  } finally {
    if (before === null) fs.rmSync(removal.REMOVED_FILE, { force: true }); else fs.writeFileSync(removal.REMOVED_FILE, before);
  }
  // CONTROL: the same name resolves again once the cards read.
  assert.equal((await plan({ name: 'Sub-Zero', account: 'spare', resolve: '1' })).j.name, 'subzero');
});
