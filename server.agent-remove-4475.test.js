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

/* A birth line as engine/create.js writes it for an agent an agent made through POST /api/team: createdByAgent, and the
   profile id the agent's profile carries (minted on the profile's first write). `extra` overrides fields per case. */
function born(name, createdBy, extra = {}) {
  fs.mkdirSync(path.dirname(create.createdLogFile()), { recursive: true });
  store.writeProfile(create.slugFor(name), {});
  const id = store.readProfile(create.slugFor(name)).id;
  assert.ok(id, 'the test could not mint a profile id for ' + name);
  fs.appendFileSync(create.createdLogFile(), JSON.stringify({ name, outcome: 'created', createdBy, createdByAgent: true, id, ...extra }) + '\n');
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

test('a birth the person made (no createdByAgent) never makes an agent of the recorded creator\'s name the owner', async () => {
  // The org-chart import records createdBy "operator" and the setup guide "kosmos"; an agent can take either name.
  const op = sendertoken.mint('operator');
  assert.ok(op.ok);
  born('Imported Kid', 'operator', { createdByAgent: undefined });
  const r = await remove('imported-kid', { 'x-kosmos-agent-token': op.token });
  assert.equal(r.code, 403, 'an agent named operator removed an agent the person imported: ' + r.text.slice(0, 160));
  assert.match(r.text, NOT_YOURS);
  born('Imported Ok', 'operator');
  assert.ok(reachedEngine(await remove('imported-ok', { 'x-kosmos-agent-token': op.token })), 'CONTROL: the same token with an agent-made birth did not pass');
});

test('a name freed and used again is not the old creator\'s (the birth\'s profile id must be the current one)', async () => {
  born('Reborn Kid', 'pm-agent');
  const before = store.readProfile('reborn-kid').id;
  // Deleting what is left of an agent (#514) removes its profile; the next agent of that name mints a new id.
  const want = store.profileFileName('reborn-kid');
  const find = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const fp = path.join(dir, e.name); if (e.isDirectory()) { const hit = find(fp); if (hit) return hit; } else if (e.name === want && path.basename(dir) === store.PROFILES_DIRNAME) return fp; } return null; };
  const file = find(SANDBOX);
  assert.ok(fs.existsSync(file), 'the test did not find the profile it meant to delete: ' + file);
  fs.rmSync(file);
  store.writeProfile('reborn-kid', {});
  assert.notEqual(store.readProfile('reborn-kid').id, before, 'the test did not make a new incarnation');
  const r = await remove('reborn-kid', asAgent());
  assert.equal(r.code, 403, 'a stale birth gave removal of a new agent of the same name: ' + r.text.slice(0, 160));
  assert.match(r.text, NOT_YOURS);
});

test('a birth with no profile id (dry run, or before #170) is not honoured', async () => {
  born('No Id Kid', 'pm-agent', { id: null });
  const r = await remove('no-id-kid', asAgent());
  assert.equal(r.code, 403);
  assert.match(r.text, NOT_YOURS);
});

test('an older token that carries only its key (no name) is refused, even for its own creation', async () => {
  const minted = sendertoken.mint('key-only');
  assert.ok(minted.ok);
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
