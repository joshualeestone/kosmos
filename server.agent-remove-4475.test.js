'use strict';
require('./test-support/tmpscope');

/**
 * #4475 step 3: on an enforcing board, an agent that presents only its own agent token may remove an agent it
 * created, and no other; it may not force a removal. The person (the board token) is unaffected.
 *
 * Same harness as server.agent-token-gate-4491.test.js: the board boots fully sandboxed, then enforcement is
 * flipped on in memory. The creator is read from the birth log, so each case writes the birth lines it needs.
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agentremove-4475-'));
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
const create = require('./engine/create');
const store = require('./engine/store');
const removal = require('./engine/remove');
const liveness = require('./engine/liveness');
const fleet = require('./test-support/fleet');

const BOARD = 'BOARDTOKEN_test_4475_0123456789abcdef';
const GATE_REFUSAL = /this board belongs to the account that started it/;
const NOT_YOURS = /an agent can remove only an agent it created/;
let base;
let pmToken;
let board;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
  boardAuthState.on = true;
  boardAuthState.token = BOARD;
  board = fleet.install([]);   // an empty roster: each test agent is paneless, known by its heartbeat
  pmToken = agentToken('pm-agent');
});

/* A live agent holding a token (paneless: known by its heartbeat). */
function agentToken(name) {
  const minted = sendertoken.mint(name);
  assert.ok(minted.ok, 'could not mint an agent token for ' + name + ': ' + minted.because);
  liveness.seen(store.safeKey(name));
  return minted.token;
}

/* A birth line as engine/create.js writes it for an agent an agent made through POST /api/team: the time, and
   createdByName (the asking agent's exact token name). `extra` overrides fields per case. */
function born(name, createdBy, extra = {}) {
  fs.mkdirSync(path.dirname(create.createdLogFile()), { recursive: true });
  fs.appendFileSync(create.createdLogFile(), JSON.stringify({ at: new Date().toISOString(), name, outcome: 'created', createdBy: store.safeKey(createdBy), createdByName: createdBy, ...extra }) + '\n');
}
async function remove(name, headers, query = '') {
  const res = await fetch(`${base}/api/agent/${encodeURIComponent(name)}/removal${query}`, { method: 'DELETE', redirect: 'manual', headers });
  const text = await res.text().catch(() => '');
  let json = null; try { json = JSON.parse(text); } catch { json = null; }
  return { code: res.status, text, json };
}
const asAgent = () => ({ 'x-kosmos-agent-token': pmToken });
const asPerson = () => ({ 'x-kosmos-board-token': BOARD });
// The removal engine answered (whatever it decided): every engine answer carries an outcome.
const reachedEngine = (r) => Boolean(r.json && typeof r.json.outcome === 'string');

test('CONTROL: a removal with no credential is refused at the gate', async () => {
  const r = await remove('anyone', {});
  assert.ok(r.code === 403 && GATE_REFUSAL.test(r.text), `a bare DELETE was not refused at the gate: ${r.code} ${r.text.slice(0, 120)}`);
});

test('CONTROL: the person token reaches the removal engine (the harness can show a pass)', async () => {
  const r = await remove('nobody-made-this', asPerson());
  assert.ok(reachedEngine(r), `the board token did not reach the removal engine: ${r.code} ${r.text.slice(0, 160)}`);
});

test('a token-only agent may remove an agent it created', async () => {
  born('Helper One', 'pm-agent');
  const r = await remove('helper-one', asAgent());
  assert.ok(!GATE_REFUSAL.test(r.text), 'refused at the gate: ' + r.text.slice(0, 120));
  assert.ok(!NOT_YOURS.test(r.text), 'refused as not its creation: ' + r.text.slice(0, 160));
  assert.ok(reachedEngine(r), `its own creation did not reach the removal engine: ${r.code} ${r.text.slice(0, 160)}`);
});

test('the creator is matched by its exact token name: a name with a period, and an adopted agent\'s capitals', async () => {
  const kip = { token: agentToken('Dr. Kip') };
  born('Kip Kid', 'Dr. Kip');
  assert.ok(reachedEngine(await remove('kip-kid', { 'x-kosmos-agent-token': kip.token })), 'a creator with a period was not matched');
  const casey = { token: agentToken('Casey') };
  born('Casey Kid', 'Casey');
  assert.ok(reachedEngine(await remove('casey-kid', { 'x-kosmos-agent-token': casey.token })), 'an adopted creator with capitals was not matched');
});

test('a different agent whose name folds to the same slug or key is not the creator', async () => {
  born('Kip Kid Two', 'Dr. Kip');
  for (const other of ['dr-kip', 'drkip', 'DR. KIP']) {
    const t = { token: agentToken(other) };
    const r = await remove('kip-kid-two', { 'x-kosmos-agent-token': t.token });
    assert.equal(r.code, 403, `${other} removed an agent Dr. Kip made: ${r.text.slice(0, 160)}`);
  }
});

test('a creator spelled differently (capitals) is a different agent', async () => {
  born('Caps Kid', 'PM-Agent');
  const r = await remove('caps-kid', asAgent());
  assert.equal(r.code, 403, 'pm-agent removed an agent PM-Agent made: ' + r.text.slice(0, 160));
});

test('a token-only agent names the target by its board name: another spelling is refused before the engine', async () => {
  born('Helper Case', 'pm-agent');
  for (const spelled of ['HELPER-CASE', 'helper.case', 'Helper Case']) {
    const r = await remove(spelled, asAgent());
    assert.equal(r.code, 400, `${spelled} was not refused: ${r.code} ${r.text.slice(0, 160)}`);
    assert.match(r.text, /name the agent by its board name \(helper-case\)/);
  }
  assert.ok(reachedEngine(await remove('helper-case', asAgent())), 'CONTROL: the board name did not pass');
});

test('the person may still use any spelling the engine accepts (the spelling rule is the token-only caller\'s)', async () => {
  const r = await remove('Some Person Spelling', asPerson());
  assert.ok(reachedEngine(r), `the board token was held to the board name: ${r.code} ${r.text.slice(0, 160)}`);
});

test('a token-only agent may not remove an agent another agent created', async () => {
  born('Someone Else Kid', 'other-agent');
  const r = await remove('someone-else-kid', asAgent());
  assert.equal(r.code, 403);
  assert.match(r.text, NOT_YOURS);
});

test('a token-only agent may not remove an agent with no recorded creator (the person made it, or before the log)', async () => {
  const r = await remove('made-by-the-person', asAgent());
  assert.equal(r.code, 403);
  assert.match(r.text, NOT_YOURS);
});

test('a token-only agent may not remove itself (it was made by another agent, or by the person)', async () => {
  born('PM Agent', 'other-agent');
  const r = await remove('pm-agent', asAgent());
  assert.equal(r.code, 403);
  assert.match(r.text, NOT_YOURS);
});

test('the newest birth decides the creator: a name recreated by another agent is no longer ours', async () => {
  born('Reused Name', 'pm-agent');
  born('Reused Name', 'other-agent');
  const r = await remove('reused-name', asAgent());
  assert.equal(r.code, 403, 'the older birth was taken as the creator: ' + r.text.slice(0, 160));
  born('Reused Back', 'other-agent');
  born('Reused Back', 'pm-agent');
  assert.ok(reachedEngine(await remove('reused-back', asAgent())), 'the newest birth (ours) did not decide');
});

test('a refused birth does not make its creator the owner', async () => {
  fs.appendFileSync(create.createdLogFile(), JSON.stringify({ name: 'Never Made', outcome: 'refused', createdBy: 'pm-agent' }) + '\n');
  const r = await remove('never-made', asAgent());
  assert.equal(r.code, 403);
  assert.match(r.text, NOT_YOURS);
});

test('a birth the person made (no createdByName) never makes an agent of the recorded creator\'s name the owner', async () => {
  // The org-chart import records createdBy "operator" and the setup guide "kosmos"; an agent can take either name.
  const op = { token: agentToken('operator') };
  born('Imported Kid', 'operator', { createdByName: undefined, createdById: undefined });
  const r = await remove('imported-kid', { 'x-kosmos-agent-token': op.token });
  assert.equal(r.code, 403, 'an agent named operator removed an agent the person imported: ' + r.text.slice(0, 160));
  assert.match(r.text, NOT_YOURS);
  born('Imported Ok', 'operator');
  assert.ok(reachedEngine(await remove('imported-ok', { 'x-kosmos-agent-token': op.token })), 'CONTROL: the same token with an agent-made birth did not pass');
});

test('an older token that carries only its key (no name) is refused, even for its own creation', async () => {
  const minted = { token: agentToken('key-only') };
  born('Key Kid', 'key-only');
  assert.ok(reachedEngine(await remove('key-kid', { 'x-kosmos-agent-token': minted.token })), 'CONTROL: the named token did not pass');
  // Strip the name, as a token minted before #4792 has none.
  let rewrote = 0;
  for (const f of fs.readdirSync(sendertoken.DIR)) {
    const fp = path.join(sendertoken.DIR, f);
    let list; try { list = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { continue; }
    const arr = Array.isArray(list) ? list : (list && Array.isArray(list.tokens) ? list.tokens : null);
    if (!arr) continue;
    let hit = false;
    for (const t of arr) if (t && t.token === minted.token) { delete t.name; hit = true; }
    if (hit) { fs.writeFileSync(fp, JSON.stringify(list)); rewrote++; }
  }
  assert.equal(rewrote, 1, 'the test could not find the token file to make it key-only');
  born('Key Kid Two', 'key-only');
  const r = await remove('key-kid-two', { 'x-kosmos-agent-token': minted.token });
  assert.equal(r.code, 403, 'a key-only token removed an agent: ' + r.text.slice(0, 160));
  assert.match(r.text, NOT_YOURS);
});

test('ownership ends when the target is removed after its birth (a later agent of that name, or a restore, is not ours)', async () => {
  born('Reborn Kid', 'pm-agent');
  assert.ok(reachedEngine(await remove('reborn-kid', asAgent())), 'CONTROL: its own creation did not pass before the removal');
  removal.noteRemoval('reborn-kid');
  const r = await remove('reborn-kid', asAgent());
  assert.equal(r.code, 403, 'a removal after the birth did not end ownership: ' + r.text.slice(0, 160));
  assert.match(r.text, NOT_YOURS);
});

test('ownership ends when the creator is removed after the birth: a later agent of the creator\'s name is not the creator', async () => {
  const first = agentToken('Builder');
  born('Built Kid', 'Builder');
  assert.ok(reachedEngine(await remove('built-kid', { 'x-kosmos-agent-token': first })), 'CONTROL: the creator itself did not pass');
  born('Built Kid Two', 'Builder');
  removal.noteRemoval(store.safeKey('Builder'));   // the creator removed (as the route records a paneless agent: its key)
  sendertoken.revoke('Builder');
  const second = agentToken('Builder');
  const r = await remove('built-kid-two', { 'x-kosmos-agent-token': second });
  assert.equal(r.code, 403, 'a new agent reusing the creator\'s name removed the old creator\'s work: ' + r.text.slice(0, 160));
  assert.match(r.text, NOT_YOURS);
});

test('a removal BEFORE the birth, or of another agent, does not end ownership', async () => {
  removal.noteRemoval('early-kid');
  removal.noteRemoval('pm-agent-other');
  born('Early Kid', 'pm-agent', { at: new Date(Date.now() + 2000).toISOString() });
  assert.ok(reachedEngine(await remove('early-kid', asAgent())), 'an older removal of the name, or another agent\'s, ended ownership');
});

test('a later partial creation of the name is a different agent: the older agent-made birth no longer counts', async () => {
  born('Partial Kid', 'pm-agent');
  born('Partial Kid', 'operator', { outcome: 'partial', createdByName: undefined });
  const r = await remove('partial-kid', asAgent());
  assert.equal(r.code, 403, 'an older birth outranked a newer partial one: ' + r.text.slice(0, 160));
});

test('a birth with no time is not honoured', async () => {
  born('Timeless Kid', 'pm-agent', { at: undefined });
  const r = await remove('timeless-kid', asAgent());
  assert.equal(r.code, 403);
  assert.match(r.text, NOT_YOURS);
});

test('a token-only agent may not force a removal, even of its own creation', async () => {
  born('Helper Force', 'pm-agent');
  const r = await remove('helper-force', asAgent(), '?force=1');
  assert.equal(r.code, 403);
  assert.match(r.text, /only the person can force a removal/);
});

test('the person removes any agent, whoever created it', async () => {
  born('Person Removes', 'other-agent');
  assert.ok(reachedEngine(await remove('person-removes', asPerson())), 'the board token was narrowed');
});

test('a caller holding the board token as well as an agent token is treated as the person (advisory for such agents)', async () => {
  born('Both Tokens', 'other-agent');
  const r = await remove('both-tokens', { ...asAgent(), ...asPerson() });
  assert.ok(reachedEngine(r), `a board-token caller was narrowed: ${r.code} ${r.text.slice(0, 160)}`);
});

test('a revoked agent token no longer removes even its own creation', async () => {
  const minted = { token: agentToken('short-lived') };
  born('Short Kid', 'short-lived');
  assert.ok(reachedEngine(await remove('short-kid', { 'x-kosmos-agent-token': minted.token })), 'CONTROL: the live token did not pass');
  sendertoken.revoke('short-lived');
  born('Short Kid Two', 'short-lived');
  const r = await remove('short-kid-two', { 'x-kosmos-agent-token': minted.token });
  assert.ok(r.code === 403 && GATE_REFUSAL.test(r.text), `a revoked token removed an agent: ${r.code} ${r.text.slice(0, 120)}`);
});

test('planning and restoring a removal still need the board token', async () => {
  born('Plan Kid', 'pm-agent');
  for (const [method, p] of [['GET', '/api/agent/plan-kid/removal'], ['POST', '/api/agent/plan-kid/restore']]) {
    const res = await fetch(base + p, { method, redirect: 'manual', headers: asAgent() });
    const text = await res.text();
    assert.ok(res.status === 403 && GATE_REFUSAL.test(text), `${method} ${p} was reachable with only an agent token: ${res.status}`);
  }
});

test('a removal history that cannot be read refuses (last: it replaces the history file with a folder)', async () => {
  born('Unread Kid', 'pm-agent');
  assert.ok(reachedEngine(await remove('unread-kid', asAgent())), 'CONTROL: it passed while the history was readable');
  try { fs.rmSync(removal.REMOVALS_LOG, { force: true }); } catch { /* none yet */ }
  fs.mkdirSync(removal.REMOVALS_LOG, { recursive: true });
  const r = await remove('unread-kid', asAgent());
  assert.equal(r.code, 403, 'an unreadable history was read as no removals: ' + r.text.slice(0, 160));
});

test.after(() => {
  try { board.restore(); } catch { /* ignore */ }
  try { server.close(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});
