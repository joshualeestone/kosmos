'use strict';
/**
 * kosmos#5590, driven through the REAL POST /api/team route. Josh asked whether making a team of agents tells
 * installkosmos.com anything; it told nothing, so a team's members never reached the homepage's agent count.
 * Asserted here: a team create sends exactly ONE agent-created ping carrying the install's total ever created
 * (not one per member); a partial team pings once; a refused team and `notifyCreated:false` ping nothing.
 *
 * The harness is server.createdbeacon-route-3038.test.js's (sandboxed roots, DRY_RUN, fake bins; the sender is
 * injected inside each test so a capture holds only that test's pings).
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-teamping-5590-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(os.tmpdir(), 'aw-teamping5590-claude-' + process.pid + '.json');
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;

fs.writeFileSync(path.join(HOME, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'default@example.com' } }));
fs.mkdirSync(path.join(HOME, '.claude', 'projects'), { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server, boardAuthState } = require('./server');
const sendertoken = require('./engine/sendertoken');
const liveness = require('./engine/liveness');
const fleet = require('./test-support/fleet');
const create = require('./engine/create');
const createdbeacon = require('./engine/createdbeacon');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  try { server.closeAllConnections(); server.close(); } catch { /* going away */ }
  create.setClaudeProbe(null);
  createdbeacon.setSender(null);
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

async function postTeam(body, headers = {}) {
  const res = await fetch(base + '/api/team', {
    method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers), body: JSON.stringify(body),
  });
  let json = null; try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

/* The agent-created pings only: an install ping also carries a count (0), so the filter is count > 0, which holds by
   construction rather than by the install ping happening to fire before a sender is injected. */
function captureCreated() {
  const calls = [];
  createdbeacon.setSender((url, init) => {
    let b = null; try { b = JSON.parse(init && init.body); } catch { b = null; }
    if (b && typeof b.count === 'number' && b.count > 0) calls.push(b);
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
  });
  return calls;
}
const settle = () => new Promise((r) => setTimeout(r, 50));
const LIVE = async () => ({ exitCode: 0, out: 'ok' });

test('#5590: a team of three sends exactly ONE created ping, carrying the full total ever created', async () => {
  const calls = captureCreated();
  create.setClaudeProbe(LIVE);
  try {
    const before = create.createdCount();
    const r = await postTeam({ creator: 'pmboss', purpose: 'count the team',
      members: [{ name: 'tpone', role: 'pm' }, { name: 'tptwo', role: 'pm' }, { name: 'tpthree', role: 'pm' }] });
    assert.equal(r.json && r.json.outcome, 'created', JSON.stringify(r.json));
    await settle();
    assert.equal(calls.length, 1, 'a team must send one ping, not ' + calls.length);
    assert.equal(calls[0].count, before + 3, 'the ping must carry the total including all three members');
    assert.equal(calls[0].count, create.createdCount(), 'the ping must carry the install total');
  } finally { create.setClaudeProbe(null); createdbeacon.setSender(null); }
});

test('#5590: a partial team (one member refused) still pings once', async () => {
  const calls = captureCreated();
  create.setClaudeProbe(LIVE);
  try {
    const r = await postTeam({ creator: 'pmboss', purpose: 'half a team',
      members: [{ name: 'tplive', role: 'pm' }, { name: 'tpdead', role: 'pm', provider: 'openai' }] });
    assert.equal(r.json && r.json.outcome, 'partial', JSON.stringify(r.json));
    await settle();
    assert.equal(calls.length, 1, 'a partial team created one agent and must ping once');
    assert.equal(calls[0].count, create.createdCount());
  } finally { create.setClaudeProbe(null); createdbeacon.setSender(null); }
});

test('#5590: CONTROL, a refused team (nobody created) sends no ping', async () => {
  const calls = captureCreated();
  create.setClaudeProbe(LIVE);
  try {
    const r = await postTeam({ creator: 'pmboss', purpose: 'all dead',
      members: [{ name: 'tpdeadone', role: 'pm', provider: 'openai' }, { name: 'tpdeadtwo', role: 'pm', provider: 'openai' }] });
    assert.equal(r.status, 400, JSON.stringify(r.json));
    const noPurpose = await postTeam({ creator: 'pmboss', members: [{ name: 'tpnopurpose', role: 'pm' }] });
    assert.equal(noPurpose.json && noPurpose.json.outcome, 'refused', JSON.stringify(noPurpose.json));
    await settle();
    assert.equal(calls.length, 0, 'a team that created nobody sent a ping');
  } finally { create.setClaudeProbe(null); createdbeacon.setSender(null); }
});

test('#5590: notifyCreated:false (the create-agent box off) sends no ping, though the team is made', async () => {
  const calls = captureCreated();
  create.setClaudeProbe(LIVE);
  try {
    const r = await postTeam({ creator: 'pmboss', purpose: 'quiet team', notifyCreated: false,
      members: [{ name: 'tpquiet', role: 'pm' }] });
    assert.equal(r.json && r.json.outcome, 'created', JSON.stringify(r.json));
    await settle();
    assert.equal(calls.length, 0, 'the box was off and a ping went anyway');
  } finally { create.setClaudeProbe(null); createdbeacon.setSender(null); }
});

test('#5590: an AGENT building a team (the creator-lock branch) pings once; a per-creator cap refusal pings none', async () => {
  const calls = captureCreated();
  create.setClaudeProbe(LIVE);
  const TOK = 'BOARDTOKEN_teamping_0123456789abcdef';
  const wasOn = boardAuthState.on; const wasTok = boardAuthState.token;
  boardAuthState.on = true; boardAuthState.token = TOK;
  const prevCap = process.env.AGENT_WORKFORCE_CREATOR_AGENT_CAP;
  const board = fleet.install([]);
  try {
    const tok = sendertoken.mint('tpagent').token;
    liveness.seen('tpagent');
    const r = await postTeam({ purpose: 'an agent builds a team', members: [{ name: 'tpagentone', role: 'pm' }, { name: 'tpagenttwo', role: 'pm' }] },
      { 'x-kosmos-agent-token': tok });
    assert.equal(r.json && r.json.outcome, 'created', JSON.stringify(r.json));
    await settle();
    assert.equal(calls.length, 1, 'an agent-built team must ping once');
    assert.equal(calls[0].count, create.createdCount());
    // The per-creator cap: two already made, a cap of 2, one more refused before anything is created.
    process.env.AGENT_WORKFORCE_CREATOR_AGENT_CAP = '2';
    const capped = await postTeam({ purpose: 'one too many', members: [{ name: 'tpagentthree', role: 'pm' }] },
      { 'x-kosmos-agent-token': tok });
    assert.equal(capped.status, 400, JSON.stringify(capped.json));
    assert.match(String(capped.json && capped.json.because), /per-creator cap/, JSON.stringify(capped.json));
    await settle();
    assert.equal(calls.length, 1, 'a team refused at the per-creator cap sent a ping');
  } finally {
    if (prevCap === undefined) delete process.env.AGENT_WORKFORCE_CREATOR_AGENT_CAP; else process.env.AGENT_WORKFORCE_CREATOR_AGENT_CAP = prevCap;
    board.restore(); boardAuthState.on = wasOn; boardAuthState.token = wasTok;
    create.setClaudeProbe(null); createdbeacon.setSender(null);
  }
});
