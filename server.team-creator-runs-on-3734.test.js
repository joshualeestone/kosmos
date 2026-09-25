'use strict';
/**
 * #3734: the setup guide makes agents with `kosmos agent create`, a one-member POST /api/team with its
 * launch token. A member with no provider named runs where the agent that asked runs, so a guide on the
 * model the person connected makes agents on that model, not on Claude by default. An explicit provider
 * is left as asked.
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-team-runs-on-3734-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_CODEX_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(os.tmpdir(), 'aw-team-runs-on-claude-' + process.pid + '.json');
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;

// A signed-in default Claude account and no OpenAI account: a Claude create proceeds, an OpenAI one is
// refused naming OpenAI, which is how the tests see which provider a member got.
fs.writeFileSync(path.join(HOME, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'default@example.com' } }));
fs.mkdirSync(path.join(HOME, '.claude', 'projects'), { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server, creatorRunsOn } = require('./server');
const create = require('./engine/create');
const sendertoken = require('./engine/sendertoken');
const store = require('./engine/store');
const fleet = require('./test-support/fleet');

const GUIDE = 'guidebot';
let base;
let board;
test.before(async () => {
  board = fleet.install([fleet.agent(GUIDE, { state: 'idle' })]);
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  try { board.restore(); } catch { /* best effort */ }
  try { server.closeAllConnections(); server.close(); } catch { /* going away */ }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

const token = () => { const m = sendertoken.mint(GUIDE); assert.equal(m.ok, true, 'could not mint a token'); return m.token; };
const team = async (members) => {
  const res = await fetch(base + '/api/team', { method: 'POST', headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': token() },
    body: JSON.stringify({ purpose: 'the person asked for it', members }) });
  return { status: res.status, json: await res.json() };
};
let n = 0;
const fresh = () => 'member' + (++n);

test('#3734 a member with no provider runs on the asking agent\'s provider', async () => {
  store.writeProfile(GUIDE, { provider: 'openai' });
  const r = await team([{ name: fresh(), role: 'pm' }]);
  assert.match(JSON.stringify(r.json), /OpenAI/, 'the member did not get the guide\'s provider: ' + JSON.stringify(r.json));
  assert.equal((r.json.created || []).length, 0);
  store.writeProfile(GUIDE, { provider: 'anthropic' });
  const ok = await team([{ name: fresh(), role: 'pm' }]);
  assert.equal((ok.json.created || []).length, 1, 'CONTROL: on a Claude guide the same member is made: ' + JSON.stringify(ok.json));
});

test('#3734 a member that names its provider keeps it', async () => {
  store.writeProfile(GUIDE, { provider: 'openai' });
  try {
    const r = await team([{ name: fresh(), role: 'pm', provider: 'anthropic' }]);
    assert.equal((r.json.created || []).length, 1, 'an explicit provider was overridden: ' + JSON.stringify(r.json));
  } finally { store.writeProfile(GUIDE, { provider: 'anthropic' }); }
});

test('#3734 creatorRunsOn reads the account folder off the launch job, and needs a recorded provider', () => {
  const was = create.readJob;
  create.readJob = () => ({ configDir: '/Users/someone/.codex-work' });
  try {
    store.writeProfile(GUIDE, { provider: 'openai' });
    assert.deepEqual(creatorRunsOn(GUIDE), { provider: 'openai', account: '/Users/someone/.codex-work' });
    create.readJob = () => ({ configDir: null });
    assert.deepEqual(creatorRunsOn(GUIDE), { provider: 'openai', account: null }, 'a default account is named');
    assert.equal(creatorRunsOn('nobody-here'), null, 'an agent with no recorded provider got one');
  } finally { create.readJob = was; store.writeProfile(GUIDE, { provider: 'anthropic' }); }
});
