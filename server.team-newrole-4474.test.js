'use strict';
/**
 * #4474 end to end through POST /api/team: an AGENT (its launch token) can make an agent with a role it wrote,
 * as the `own` role with a label and text; it cannot ask for the setup guide, nor put its own text under a
 * built-in role's key. The operator path is not vetted (CONTROL). What the text becomes ({{NAME}}, the identity
 * line) is engine/team.newrole-4474.test.js's. Same sandbox as server.team-agent-token-1279.
 */
require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-team-newrole-4474-'));
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
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;

fs.writeFileSync(path.join(HOME, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'default@example.com' } }));
fs.mkdirSync(path.join(HOME, '.claude', 'projects'), { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server, boardAuthState } = require('./server');
const create = require('./engine/create');
const sendertoken = require('./engine/sendertoken');
const liveness = require('./engine/liveness');
const fleet = require('./test-support/fleet');

const TOK = 'BOARDTOKEN_newrole_0123456789abcdef';
let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  boardAuthState.on = true;
  boardAuthState.token = TOK;
});
test.after(() => {
  try { server.closeAllConnections(); server.close(); } catch { /* going away */ }
  create.setClaudeProbe(null);
  boardAuthState.on = false;
});

const LIVE = async () => ({ exitCode: 0, out: 'ok' });
async function postTeam(body, headers) {
  const res = await fetch(base + '/api/team', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers), body: JSON.stringify(body) });
  let json = null; try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}
// The log records refused attempts too (outcome 'refused'), so "was it made" is a CREATED record.
const birthOf = (name) => create.createdLog().filter((e) => e && e.name === name && e.outcome === 'created').pop() || null;
async function asAgent(creator, members) {
  create.setClaudeProbe(LIVE);
  const tok = sendertoken.mint(creator).token;
  liveness.seen(creator);
  const board = fleet.install([]);
  try { return await postTeam({ purpose: 'the team needs it', members }, { 'x-kosmos-agent-token': tok }); } finally { board.restore(); create.setClaudeProbe(null); }
}

test('#4474: an agent makes an agent with a role it wrote, recorded as the own role with its label', async () => {
  const r = await asAgent('pmone', [{ name: 'Ann', role: 'own', label: 'Grant writer', instructions: 'Write grant applications.\n{{NAME}} signs every draft.\n' }]);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.outcome, 'created', JSON.stringify(r.json));
  // The birth log records the name as shown (the slug is what the route returns); the text itself is
  // engine/team.newrole-4474.test.js's (a dry run writes no instruction file).
  const b = birthOf('Ann');
  assert.ok(b, 'no birth record for the agent made with a new role');
  assert.equal(b.role, 'own', 'the made-up role was not recorded as the own role');
  assert.equal(b.createdBy, 'pmone');
});

test('#4474: an agent cannot ask for the setup guide, nor put its own text under a built-in role', async () => {
  const guide = await asAgent('pmthree', [{ name: 'Gus', role: 'setup' }]);
  assert.equal(guide.json.outcome, 'refused', JSON.stringify(guide.json));
  assert.match(guide.json.refused[0].because, /setup guide is Kosmos's own/);
  assert.equal(birthOf('Gus'), null, 'a second guide was made');
  const dressed = await asAgent('pmthree', [{ name: 'Pam', role: 'pm', label: 'Project Manager', instructions: 'You are **{{NAME}}**, a project manager who does something else entirely.' }]);
  assert.equal(dressed.json.outcome, 'refused', JSON.stringify(dressed.json));
  assert.match(dressed.json.refused[0].because, /role's own label and text are not replaced/);
  assert.equal(birthOf('Pam'), null);
});

test('#4474: an agent\'s blank role text is refused by create\'s own rule, and no agent is made', async () => {
  const r = await asAgent('pmfour', [{ name: 'Nil', role: 'own', label: 'Writer', instructions: '   \n' }]);
  assert.equal(r.json.outcome, 'refused', JSON.stringify(r.json));
  assert.match(r.json.refused[0].because, /instructions (have to be words|cannot be this short)/);
  assert.equal(birthOf('Nil'), null, 'an agent whose whole brief is its name was made');
});

test('#4474: a setup role sent as a list (["setup"]) is refused too; create would read it as "setup"', async () => {
  const r = await asAgent('pmfive', [{ name: 'Gil', role: ['setup'] }]);
  assert.equal(r.json.outcome, 'refused', JSON.stringify(r.json));
  assert.match(r.json.refused[0].because, /setup guide is Kosmos's own/);
  assert.equal(birthOf('Gil'), null, 'a second guide was made from a role sent as a list');
});

test('#4474 CONTROL: the same built-in-role-with-a-label request from the operator is not vetted', async () => {
  create.setClaudeProbe(LIVE);
  const board = fleet.install([]);
  try {
    const r = await postTeam({ creator: 'opsboss', purpose: 'operator', members: [{ name: 'Opal', role: 'pm', label: 'Lead' }] }, { 'x-kosmos-board-token': TOK });
    assert.equal(r.json.outcome, 'created', 'the operator path was vetted as an agent: ' + JSON.stringify(r.json));
  } finally { board.restore(); create.setClaudeProbe(null); }
});
