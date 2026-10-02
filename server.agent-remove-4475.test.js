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

const BOARD = 'BOARDTOKEN_test_4475_0123456789abcdef';
const GATE_REFUSAL = /this board belongs to the account that started it/;
const NOT_YOURS = /an agent can remove only an agent it created/;
let base;
let pmToken;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
  boardAuthState.on = true;
  boardAuthState.token = BOARD;
  const minted = sendertoken.mint('pm-agent');
  assert.ok(minted.ok, 'could not mint an agent token for the test: ' + minted.because);
  pmToken = minted.token;
});

function born(name, createdBy) {
  fs.mkdirSync(path.dirname(create.createdLogFile()), { recursive: true });
  fs.appendFileSync(create.createdLogFile(), JSON.stringify({ name, outcome: 'created', createdBy }) + '\n');
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

test('the creator is matched by slug, as the creation cap counts it', async () => {
  born('Helper Two', 'PM-Agent');
  const r = await remove('helper-two', asAgent());
  assert.ok(reachedEngine(r), `a creator spelled with capitals was not matched: ${r.code} ${r.text.slice(0, 160)}`);
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

test('a token-only agent may not remove itself', async () => {
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
  const minted = sendertoken.mint('short-lived');
  assert.ok(minted.ok);
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

test.after(() => {
  try { server.close(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});
