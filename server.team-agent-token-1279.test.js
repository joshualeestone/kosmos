'use strict';
/**
 * #1279 agent-token slice: POST /api/team is AGENT-callable (loopback), with the
 * caller's identity as the un-forgeable creator, a per-creator GLOBAL active-agent
 * cap, and NO network exposure.
 *
 * This proves the security-sensitive half end to end:
 *   - Network: /api/team is NOT in REMOTE_AGENT_ROUTES, so remoteWriteGuard refuses
 *     a network peer even with a valid agent token.
 *   - Auth (enforcing board): no credential -> 403; invalid agent token -> 403; a
 *     valid agent token -> the AUTHENTICATED caller is createdBy (a self-declared
 *     body.creator is ignored); the board token -> the operator path.
 *   - Global cap: the per-creator active-agent count (birth log x live roster)
 *     bounds accumulation across calls, on the AGENT path only (operator exempt).
 *
 * Sandboxes every create root + the Claude config (fixture-discipline), DRY_RUN +
 * fake bins so nothing launches, and drives the board's real enforcement via the
 * exported boardAuthState (the board-auth-1946 posture).
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-team-agent-token-1279-'));
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
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(os.tmpdir(), 'aw-teamtok-claude-' + process.pid + '.json');
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;
// A cap low enough to hit deliberately in the global-cap tests.
process.env.AGENT_WORKFORCE_CREATOR_AGENT_CAP = '3';

fs.writeFileSync(path.join(HOME, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'default@example.com' } }));
fs.mkdirSync(path.join(HOME, '.claude', 'projects'), { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const srv = require('./server');
const { start, server, boardAuthState, remoteWriteGuard, REMOTE_AGENT_ROUTES, LOOPBACK_AGENT_ROUTES, creatorAgentCap, activeAgentsCreatedBy } = srv;
const create = require('./engine/create');
const sendertoken = require('./engine/sendertoken');
const liveness = require('./engine/liveness');
const fleet = require('./test-support/fleet');

const TOK = 'BOARDTOKEN_teamtok_0123456789abcdef';
let base;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce by default');
  boardAuthState.on = true;
  boardAuthState.token = TOK;
});
test.after(() => {
  try { server.closeAllConnections(); server.close(); } catch { /* going away */ }
  create.setClaudeProbe(null);
  boardAuthState.on = false;
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

const LIVE = async () => ({ exitCode: 0, out: 'ok' });

async function postTeam(body, headers = {}) {
  const res = await fetch(base + '/api/team', {
    method: 'POST',
    headers: Object.assign({ 'content-type': 'application/json' }, headers),
    body: JSON.stringify(body),
  });
  let json = null; try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}
function birthOf(name) { return create.createdLog().filter((e) => e && e.name === name).pop() || null; }

// ---- Network refusal (pure, exported guard) --------------------------------

test('NETWORK: /api/team is NOT in REMOTE_AGENT_ROUTES, and IS in LOOPBACK_AGENT_ROUTES', () => {
  assert.equal(REMOTE_AGENT_ROUTES.has('POST /api/team'), false, 'team creation must not be network-reachable');
  assert.equal(LOOPBACK_AGENT_ROUTES.has('POST /api/team'), true, 'a loopback agent must be able to reach it');
});

test('NETWORK: remoteWriteGuard REFUSES a network peer for /api/team even with a valid agent token', () => {
  const tok = sendertoken.mint('netagent').token;
  const REMOTE = '203.0.113.9';
  const req = (peer, token) => ({ method: 'POST', socket: { remoteAddress: peer }, headers: token ? { 'x-kosmos-agent-token': token } : {} });
  assert.notEqual(remoteWriteGuard(req(REMOTE, tok), '/api/team'), null, 'a network peer reached team creation');
  // Control: a loopback peer passes the guard (the handler then does the real auth).
  assert.equal(remoteWriteGuard(req('127.0.0.1', tok), '/api/team'), null, 'a loopback peer should pass remoteWriteGuard');
  // Control that the guard CAN refuse the report route too without a token (it can return the dangerous answer).
  assert.notEqual(remoteWriteGuard(req(REMOTE, null), '/api/report'), null);
});

// ---- creatorAgentCap (pure) ------------------------------------------------

test('creatorAgentCap: default 25, env override, hard ceiling 100', () => {
  assert.equal(creatorAgentCap({}), 25, 'default cap');
  assert.equal(creatorAgentCap({ AGENT_WORKFORCE_CREATOR_AGENT_CAP: '10' }), 10, 'env override');
  assert.equal(creatorAgentCap({ AGENT_WORKFORCE_CREATOR_AGENT_CAP: '99999' }), 100, 'no override may exceed the hard ceiling');
  assert.equal(creatorAgentCap({ AGENT_WORKFORCE_CREATOR_AGENT_CAP: 'nonsense' }), 25, 'a garbage override falls back to the default');
  assert.equal(creatorAgentCap({ AGENT_WORKFORCE_CREATOR_AGENT_CAP: '0' }), 25, 'a non-positive override is ignored');
});

// ---- activeAgentsCreatedBy (birth log x live roster) -----------------------

test('activeAgentsCreatedBy counts only a creator\'s SUCCEEDED births whose agent is still on the roster', () => {
  // Seed the birth log: two by 'boss' (one live, one removed), one by someone else, one refused.
  const logFile = create.createdLogFile();
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const rows = [
    { createdBy: 'boss', outcome: 'created', name: 'liveone' },
    { createdBy: 'boss', outcome: 'created', name: 'goneone' },   // not on roster -> not counted
    { createdBy: 'boss', outcome: 'refused', name: 'refusedone' }, // refused -> not counted
    { createdBy: 'other', outcome: 'created', name: 'notmine' },   // different creator
  ];
  fs.writeFileSync(logFile, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const board = fleet.install([fleet.agent('liveone'), fleet.agent('notmine')]);
  try {
    assert.equal(activeAgentsCreatedBy('boss'), 1, 'only the live, succeeded, own-created agent counts');
    assert.equal(activeAgentsCreatedBy('other'), 1);
    assert.equal(activeAgentsCreatedBy('nobody'), 0);
  } finally {
    board.restore();
    fs.rmSync(logFile, { force: true });
  }
});

// ---- Route auth (enforcing board) ------------------------------------------

test('AUTH: enforcing board refuses a team request with NO credential (403)', async () => {
  const r = await postTeam({ creator: 'x', purpose: 'y', members: [{ name: 'nocredteam', role: 'pm' }] });
  assert.equal(r.status, 403, 'a no-credential request was not refused: ' + JSON.stringify(r.json));
  assert.ok(!birthOf('nocredteam'), 'a no-credential request still created an agent');
});

test('AUTH: enforcing board refuses an INVALID agent token (403)', async () => {
  const r = await postTeam(
    { creator: 'x', purpose: 'y', members: [{ name: 'badtokteam', role: 'pm' }] },
    { 'x-kosmos-agent-token': '0'.repeat(64) },
  );
  assert.equal(r.status, 403, JSON.stringify(r.json));
  assert.ok(!birthOf('badtokteam'));
});

test('AUTH: a valid AGENT token creates, and createdBy is the AUTHENTICATED caller, not the self-declared body.creator', async () => {
  create.setClaudeProbe(LIVE);
  const tok = sendertoken.mint('pmagent').token;
  liveness.seen('pmagent');
  const board = fleet.install([]); // empty roster: caller is paneless-via-heartbeat
  try {
    const r = await postTeam(
      { creator: 'IMPERSONATED', purpose: 'agent builds a team', members: [{ name: 'agentmadeone', role: 'pm' }] },
      { 'x-kosmos-agent-token': tok },
    );
    assert.equal(r.status, 200, 'a valid agent token was not accepted: ' + JSON.stringify(r.json));
    assert.equal(r.json.outcome, 'created', JSON.stringify(r.json));
    const b = birthOf('agentmadeone');
    assert.ok(b, 'the agent-created member has no birth record');
    assert.equal(b.createdBy, 'pmagent', 'createdBy must be the authenticated caller, not the forged body.creator');
    assert.notEqual(b.createdBy, 'IMPERSONATED', 'a self-declared creator was trusted (forgery)');
  } finally { board.restore(); create.setClaudeProbe(null); }
});

test('AUTH: the BOARD token drives the operator path (createdBy = body.creator)', async () => {
  create.setClaudeProbe(LIVE);
  const board = fleet.install([]);
  try {
    const r = await postTeam(
      { creator: 'opsboss', purpose: 'operator builds a team', members: [{ name: 'opsmadeone', role: 'pm' }] },
      { 'x-kosmos-board-token': TOK },
    );
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.outcome, 'created', JSON.stringify(r.json));
    const b = birthOf('opsmadeone');
    assert.ok(b);
    assert.equal(b.createdBy, 'opsboss', 'the operator path records the operator-supplied creator');
  } finally { board.restore(); create.setClaudeProbe(null); }
});

// ---- Global cap (agent path only) ------------------------------------------

test('CAP: the agent path is refused when its active-agent count + team size exceeds the per-creator cap', async () => {
  create.setClaudeProbe(LIVE);
  // Env cap is 3. Seed 3 live agents created by 'capagent'; one more member tips it over.
  const logFile = create.createdLogFile();
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, [
    { createdBy: 'capagent', outcome: 'created', name: 'capexistA' },
    { createdBy: 'capagent', outcome: 'created', name: 'capexistB' },
    { createdBy: 'capagent', outcome: 'created', name: 'capexistC' },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const tok = sendertoken.mint('capagent').token;
  liveness.seen('capagent');
  const board = fleet.install([fleet.agent('capexistA'), fleet.agent('capexistB'), fleet.agent('capexistC')]);
  try {
    const r = await postTeam(
      { creator: 'capagent', purpose: 'one too many', members: [{ name: 'capnewone', role: 'pm' }] },
      { 'x-kosmos-agent-token': tok },
    );
    assert.equal(r.status, 400, 'an over-cap agent request was not refused: ' + JSON.stringify(r.json));
    assert.equal(r.json.outcome, 'refused', JSON.stringify(r.json));
    assert.match(r.json.because || '', /per-creator cap of 3/, 'the refusal must name the per-creator cap');
    assert.ok(!birthOf('capnewone'), 'an over-cap request still created an agent');
  } finally { board.restore(); create.setClaudeProbe(null); fs.rmSync(logFile, { force: true }); }
});

test('CAP: the OPERATOR path is EXEMPT from the per-creator cap (board token, same seeded load)', async () => {
  create.setClaudeProbe(LIVE);
  const logFile = create.createdLogFile();
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, [
    { createdBy: 'opsboss', outcome: 'created', name: 'opsexistA' },
    { createdBy: 'opsboss', outcome: 'created', name: 'opsexistB' },
    { createdBy: 'opsboss', outcome: 'created', name: 'opsexistC' },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const board = fleet.install([fleet.agent('opsexistA'), fleet.agent('opsexistB'), fleet.agent('opsexistC')]);
  try {
    const r = await postTeam(
      { creator: 'opsboss', purpose: 'operator over the agent cap', members: [{ name: 'opsnewone', role: 'pm' }] },
      { 'x-kosmos-board-token': TOK },
    );
    assert.equal(r.status, 200, 'the operator path was capped like an agent: ' + JSON.stringify(r.json));
    assert.equal(r.json.outcome, 'created', JSON.stringify(r.json));
    assert.ok(birthOf('opsnewone'), 'the operator create should have succeeded despite the seeded load');
  } finally { board.restore(); create.setClaudeProbe(null); fs.rmSync(logFile, { force: true }); }
});
