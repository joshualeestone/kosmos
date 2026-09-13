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
 *   - Global cap: the per-creator active-agent count (birth log minus removed)
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
const { start, server, boardAuthState, remoteWriteGuard, REMOTE_AGENT_ROUTES, LOOPBACK_AGENT_ROUTES, creatorAgentCap, activeAgentsCreatedBy, withCreatorLock } = srv;
const create = require('./engine/create');
const sendertoken = require('./engine/sendertoken');
const liveness = require('./engine/liveness');
const remove = require('./engine/remove');
const status = require('./engine/status');
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
// Seed the removed-agents store directly (remove.js does not export a writer).
function setRemoved(list) {
  fs.mkdirSync(path.dirname(remove.REMOVED_FILE), { recursive: true });
  fs.writeFileSync(remove.REMOVED_FILE, JSON.stringify(list, null, 2) + '\n', 'utf8');
}

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

// ---- withCreatorLock (the forward-protection serialization primitive) -------
// The route's critical section is synchronous, so a route test cannot prove the
// lock serializes (it is atomic either way). These exercise the lock with an fn
// that DOES yield, so a broken/absent lock would let the sections interleave.

const tick = () => new Promise((r) => setTimeout(r, 5));

test('withCreatorLock SERIALIZES same-creator calls (a yielding fn cannot interleave)', async () => {
  const order = [];
  const slow = (id) => async () => { order.push(id + '-start'); await tick(); order.push(id + '-end'); };
  await Promise.all([withCreatorLock('lockx', slow('a')), withCreatorLock('lockx', slow('b'))]);
  // Serialized: a fully finishes before b starts. If the lock were a no-op, the
  // interleaving would be a-start, b-start, a-end, b-end.
  assert.deepEqual(order, ['a-start', 'a-end', 'b-start', 'b-end'],
    'same-creator calls interleaved -- the lock did not serialize: ' + JSON.stringify(order));
});

test('withCreatorLock does NOT serialize DIFFERENT creators (they may interleave)', async () => {
  const order = [];
  const slow = (id) => async () => { order.push(id + '-start'); await tick(); order.push(id + '-end'); };
  await Promise.all([withCreatorLock('lockp', slow('p')), withCreatorLock('lockq', slow('q'))]);
  // Different creators run concurrently: both start before either ends.
  assert.ok(order.indexOf('p-start') < order.indexOf('p-end') && order.indexOf('q-start') < order.indexOf('q-end'));
  assert.ok(order.indexOf('q-start') < order.indexOf('p-end') || order.indexOf('p-start') < order.indexOf('q-end'),
    'different creators were serialized against each other: ' + JSON.stringify(order));
});

test('withCreatorLock: a thrown fn does not break the chain for the next same-creator caller', async () => {
  const order = [];
  const boom = async () => { order.push('boom'); throw new Error('kaboom'); };
  const after = async () => { order.push('after'); return 'ok'; };
  await withCreatorLock('lockz', boom).catch(() => order.push('caught'));
  const r = await withCreatorLock('lockz', after);
  assert.equal(r, 'ok', 'the next caller after a thrown fn was not run -- the chain broke');
  assert.deepEqual(order, ['boom', 'caught', 'after']);
});

// ---- activeAgentsCreatedBy (birth log minus removed) --------------------

test('activeAgentsCreatedBy counts a creator\'s SUCCEEDED, NOT-removed births (not the live roster)', () => {
  // Seed the birth log: two by 'boss' (one still present, one removed), one refused,
  // one by someone else. The count is birth-MINUS-removed, so a fresh birth counts
  // even with NO roster (proving the fix for the roster-lag defect).
  const logFile = create.createdLogFile();
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const rows = [
    { createdBy: 'boss', outcome: 'created', name: 'presentone' },
    { createdBy: 'boss', outcome: 'created', name: 'removedone' },  // removed below -> not counted
    { createdBy: 'boss', outcome: 'refused', name: 'refusedone' },  // refused -> not counted
    { createdBy: 'other', outcome: 'created', name: 'notmine' },    // different creator
  ];
  fs.writeFileSync(logFile, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  // Mark 'removedone' removed (stopped) so it drops out of the active count.
  setRemoved([{ name: 'removedone', stopped: true, removedAt: new Date().toISOString(), shownAs: 'removedone' }]);
  try {
    assert.equal(activeAgentsCreatedBy('boss'), 1, 'only the present, succeeded, own-created agent counts (roster not consulted)');
    assert.equal(activeAgentsCreatedBy('other'), 1);
    assert.equal(activeAgentsCreatedBy('nobody'), 0);
  } finally {
    fs.rmSync(logFile, { force: true });
    try { setRemoved([]); } catch { /* best effort */ }
  }
});

test('activeAgentsCreatedBy: a name REUSED by another creator counts for the CURRENT owner, not the original (last-occurrence wins)', () => {
  // 'X' was created by alice, later (after removal/free) recreated by bob and is now
  // alive. The append-only log holds both 'created' rows, oldest-first. First-
  // occurrence-wins would keep counting alice (who no longer owns X) and never
  // count bob; last-occurrence-wins attributes X to its current owner, bob.
  const logFile = create.createdLogFile();
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, [
    { createdBy: 'alice', outcome: 'created', name: 'sharedx' },
    { createdBy: 'bob', outcome: 'created', name: 'sharedx' },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n');
  setRemoved([]); // sharedx is currently alive (bob's)
  try {
    assert.equal(activeAgentsCreatedBy('alice'), 0, 'alice no longer owns the reused name and must not still count it');
    assert.equal(activeAgentsCreatedBy('bob'), 1, 'the current owner of the reused name must count it');
  } finally { fs.rmSync(logFile, { force: true }); }
});

test('activeAgentsCreatedBy: a removed agent with a CAPITAL/space name is excluded (slug match, not trim match)', () => {
  // The birth log stores the name AS TYPED ("Casey"), removedAgents stores the
  // SLUG ("casey"). A trim-only comparison would miss the match and keep counting
  // the removed agent forever (over-refuse). Both sides must go through slugFor.
  const logFile = create.createdLogFile();
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, [
    { createdBy: 'boss', outcome: 'created', name: 'Casey' },            // removed below (slug 'casey')
    { createdBy: 'boss', outcome: 'created', name: 'Kira Knightley' },   // alive (slug 'kira-knightley')
  ].map((r) => JSON.stringify(r)).join('\n') + '\n');
  // Seed the removed record with the CAPITAL name (the cleanName shape recordRemoval
  // writes), NOT a pre-lowered slug -- so this exercises slugFor on the REMOVED side
  // too (both 'Casey' birth and 'Casey' removed must slug to 'casey' to match).
  setRemoved([{ name: 'Casey', stopped: true, removedAt: new Date().toISOString(), shownAs: 'Casey' }]);
  try {
    assert.equal(activeAgentsCreatedBy('boss'), 1,
      'a removed capital-named agent still counted -- the slug/trim mismatch was not fixed');
  } finally { fs.rmSync(logFile, { force: true }); try { setRemoved([]); } catch { /* best effort */ } }
});

test('AUTH: an unreadable roster on the agent path fails closed with 503 (not a create)', async () => {
  // Force safeRoster() -> null by making snapshot()'s pane source throw.
  const tok = sendertoken.mint('rosterfail').token;
  liveness.seen('rosterfail');
  status.setPaneSource(() => { throw new Error('roster unreadable (test)'); });
  try {
    const r = await postTeam(
      { creator: 'rosterfail', purpose: 'roster down', members: [{ name: 'rosterfailteam', role: 'pm' }] },
      { 'x-kosmos-agent-token': tok },
    );
    assert.equal(r.status, 503, 'an unreadable roster on the agent path must fail closed with 503: ' + JSON.stringify(r.json));
    assert.ok(!birthOf('rosterfailteam'), 'a 503 (roster unreadable) still created an agent');
  } finally { status.setPaneSource(null); }
});

test('activeAgentsCreatedBy: the same creator recreating a name counts it ONCE, not once per birth', () => {
  const logFile = create.createdLogFile();
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, [
    { createdBy: 'boss', outcome: 'created', name: 'recre' },
    { createdBy: 'boss', outcome: 'created', name: 'recre' }, // removed then recreated by boss
  ].map((r) => JSON.stringify(r)).join('\n') + '\n');
  setRemoved([]);
  try {
    assert.equal(activeAgentsCreatedBy('boss'), 1, 'a reused name is one live agent, counted once (deduped by name)');
  } finally { fs.rmSync(logFile, { force: true }); }
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
  // Env cap is 3. Seed 3 NON-removed births by 'capagent'; the count is birth-minus-
  // removed, so these count as active WITHOUT any roster presence (the roster-lag fix).
  const logFile = create.createdLogFile();
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, [
    { createdBy: 'capagent', outcome: 'created', name: 'capexistA' },
    { createdBy: 'capagent', outcome: 'created', name: 'capexistB' },
    { createdBy: 'capagent', outcome: 'created', name: 'capexistC' },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n');
  setRemoved([]); // nothing removed -> all three count
  const tok = sendertoken.mint('capagent').token;
  liveness.seen('capagent');
  const board = fleet.install([]); // empty roster proves the count does NOT use it
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

test('CAP: a REMOVED prior agent frees headroom (birth-minus-removed), so the same request now succeeds', async () => {
  create.setClaudeProbe(LIVE);
  const logFile = create.createdLogFile();
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, [
    { createdBy: 'freeagent', outcome: 'created', name: 'FreeA' },
    { createdBy: 'freeagent', outcome: 'created', name: 'FreeB' },
    { createdBy: 'freeagent', outcome: 'created', name: 'Free C' },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n');
  // Remove one -> active count drops to 2, so 2 + 1 = 3 is NOT over the cap of 3.
  // The birth is typed ("Free C"); the removed record is the SLUG ("free-c") the
  // real DELETE route writes, so this only frees headroom if the count slug-matches.
  setRemoved([{ name: 'free-c', stopped: true, removedAt: new Date().toISOString(), shownAs: 'Free C' }]);
  const tok = sendertoken.mint('freeagent').token;
  liveness.seen('freeagent');
  const board = fleet.install([]);
  try {
    const r = await postTeam(
      { creator: 'freeagent', purpose: 'headroom restored', members: [{ name: 'freenew', role: 'pm' }] },
      { 'x-kosmos-agent-token': tok },
    );
    assert.equal(r.status, 200, 'removing an agent did not free cap headroom: ' + JSON.stringify(r.json));
    assert.equal(r.json.outcome, 'created', JSON.stringify(r.json));
    assert.ok(birthOf('freenew'), 'the create under restored headroom should have succeeded');
  } finally { board.restore(); create.setClaudeProbe(null); fs.rmSync(logFile, { force: true }); try { setRemoved([]); } catch { /* best effort */ } }
});

test('CAP: the cap OUTCOME holds under two concurrent same-creator requests (end-to-end; the lock MECHANISM is proven by the withCreatorLock unit tests)', async () => {
  create.setClaudeProbe(LIVE);
  const logFile = create.createdLogFile();
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, ''); // start from zero active agents for 'raceagent'
  setRemoved([]);
  const prevCap = process.env.AGENT_WORKFORCE_CREATOR_AGENT_CAP;
  process.env.AGENT_WORKFORCE_CREATOR_AGENT_CAP = '1'; // cap of 1: only ONE of the two 1-member requests may create
  const tok = sendertoken.mint('raceagent').token;
  liveness.seen('raceagent');
  const board = fleet.install([]);
  try {
    const [a, b] = await Promise.all([
      postTeam({ creator: 'raceagent', purpose: 'race a', members: [{ name: 'raceone', role: 'pm' }] }, { 'x-kosmos-agent-token': tok }),
      postTeam({ creator: 'raceagent', purpose: 'race b', members: [{ name: 'racetwo', role: 'pm' }] }, { 'x-kosmos-agent-token': tok }),
    ]);
    const created = [a, b].filter((r) => r.status === 200 && r.json && r.json.outcome === 'created').length;
    const refused = [a, b].filter((r) => r.status === 400 && r.json && r.json.outcome === 'refused').length;
    assert.equal(created, 1, 'exactly one concurrent request should have created; the lock failed if both did: ' + JSON.stringify([a.json, b.json]));
    assert.equal(refused, 1, 'the other concurrent request should have been refused for the cap');
    const births = [birthOf('raceone'), birthOf('racetwo')].filter(Boolean).length;
    assert.equal(births, 1, 'exactly one agent should have been created across the two concurrent requests');
  } finally {
    board.restore(); create.setClaudeProbe(null); fs.rmSync(logFile, { force: true });
    if (prevCap === undefined) delete process.env.AGENT_WORKFORCE_CREATOR_AGENT_CAP;
    else process.env.AGENT_WORKFORCE_CREATOR_AGENT_CAP = prevCap;
  }
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
  setRemoved([]);
  const board = fleet.install([]);
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

test('#2972 AGENT path IGNORES body.cap: a model cannot raise its own bound (stays the default 12)', async () => {
  // The operator (board-token) path honours body.cap (#2972). The AGENT path must
  // NOT: otherwise a model could defeat the runaway guard by asking for a higher
  // cap in its own request. 13 members + body.cap:15 over an agent token must still
  // refuse at the default per-team cap 12. If the wiring leaked body.cap to the
  // agent path, the resolved cap would be 15 and this would not refuse at 12.
  const tok = sendertoken.mint('capignore').token;
  liveness.seen('capignore');
  const board = fleet.install([]);
  try {
    const members = Array.from({ length: 13 }, (_, i) => ({ name: 'ci' + i, role: 'pm' }));
    const r = await postTeam(
      { creator: 'capignore', purpose: 'try to raise my own bound', members, cap: 15 },
      { 'x-kosmos-agent-token': tok },
    );
    assert.equal(r.status, 400, 'the agent over-cap request should be refused: ' + JSON.stringify(r.json));
    assert.equal(r.json.cap, 12, 'the AGENT path must not honour body.cap; the cap must stay 12, got ' + JSON.stringify(r.json.cap));
    assert.match(r.json.because || '', /cap is 12/, 'the refusal must name the default per-team cap 12, not the requested 15');
  } finally { board.restore(); }
});
