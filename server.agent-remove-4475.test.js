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

/* The board runs DRY_RUN, so a removal through the route here does not revoke (recordRemoval returns first): a case may
   remove the same target twice (a CONTROL, then the case) without the first ending it. A real end is written with
   sendertoken.revoke, which removing, deleting what is left, and creating all call.
   A birth line as engine/create.js writes it for an agent an agent made through POST /api/team: the time, when the
   creator asked, and createdByName (its exact token name). `extra` overrides fields per case. The end-to-end case
   (POST /api/team, then this route) is in server.team-agent-token-1279.test.js. */
function born(name, createdBy, extra = {}) {
  fs.mkdirSync(path.dirname(create.createdLogFile()), { recursive: true });
  const now = new Date().toISOString();
  fs.appendFileSync(create.createdLogFile(), JSON.stringify({ at: now, askedAt: now, name, slug: create.slugFor(name), outcome: 'created', createdBy: store.safeKey(createdBy), createdByName: createdBy, ...extra }) + '\n');
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
  // dr-kip is on its own key, so only the exact-name comparison can refuse it (a name on Dr. Kip's key, such as
  // drkip, would make the caller a twin and be refused for that instead).
  for (const other of ['dr-kip']) {
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

test('ownership ends when the target\'s identity ends after its birth (removed, its leftovers deleted, or its name made again)', async () => {
  born('Reborn Kid', 'pm-agent');
  assert.ok(reachedEngine(await remove('reborn-kid', asAgent())), 'CONTROL: its own creation did not pass before the removal');
  sendertoken.revoke('reborn-kid');   // what removing it, deleting what is left of it, and creating it again all call
  const r = await remove('reborn-kid', asAgent());
  assert.equal(r.code, 403, 'a removal after the birth did not end ownership: ' + r.text.slice(0, 160));
  assert.match(r.text, NOT_YOURS);
});

test('ownership ends when the creator\'s identity ends: a later agent of the creator\'s name is not the creator', async () => {
  const first = agentToken('Builder');
  born('Built Kid', 'Builder');
  assert.ok(reachedEngine(await remove('built-kid', { 'x-kosmos-agent-token': first })), 'CONTROL: the creator itself did not pass');
  born('Built Kid Two', 'Builder');
  sendertoken.revoke(store.safeKey('Builder'));   // the creator removed (the route revokes a paneless agent by its key)
  const second = agentToken('Builder');
  const r = await remove('built-kid-two', { 'x-kosmos-agent-token': second });
  assert.equal(r.code, 403, 'a new agent reusing the creator\'s name removed the old creator\'s work: ' + r.text.slice(0, 160));
  assert.match(r.text, NOT_YOURS);
});

test('the target\'s own creation revokes its name just before the birth is written: an end at the birth\'s exact time is that, not a removal', async () => {
  const t = new Date(Date.now() + 5000).toISOString();
  const asked = new Date(Date.now() + 4000).toISOString();
  fs.mkdirSync(path.dirname(sendertoken.endedLogFile()), { recursive: true });
  fs.appendFileSync(sendertoken.endedLogFile(), JSON.stringify({ name: 'tie-kid', at: t }) + '\n');   // the same millisecond as the birth
  born('Tie Kid', 'pm-agent', { at: t, askedAt: asked });
  assert.ok(reachedEngine(await remove('tie-kid', asAgent())), 'the creation\'s own revoke, in the birth\'s millisecond, ended ownership');
});

test('an end BEFORE the birth, or another agent\'s, does not end ownership', async () => {
  sendertoken.revoke('early-kid');
  sendertoken.revoke('pm-agent-other');
  const later = new Date(Date.now() + 2000).toISOString();
  born('Early Kid', 'pm-agent', { at: later, askedAt: later });
  assert.ok(reachedEngine(await remove('early-kid', asAgent())), 'an older removal of the name, or another agent\'s, ended ownership');
});

test('a later partial creation of the name is a different agent: the older agent-made birth no longer counts', async () => {
  born('Partial Kid', 'pm-agent');
  born('Partial Kid', 'operator', { outcome: 'partial', createdByName: undefined });
  const r = await remove('partial-kid', asAgent());
  assert.equal(r.code, 403, 'an older birth outranked a newer partial one: ' + r.text.slice(0, 160));
});

test('a birth with no time, or no time asked, is not honoured', async () => {
  born('Timeless Kid', 'pm-agent', { at: undefined });
  born('Unasked Kid', 'pm-agent', { askedAt: undefined });
  for (const n of ['timeless-kid', 'unasked-kid']) {
    const r = await remove(n, asAgent());
    assert.equal(r.code, 403, n);
    assert.match(r.text, NOT_YOURS);
  }
});

test('a creator whose identity ended while its request ran (after it asked, before the birth) is not the creator', async () => {
  const t = agentToken('Midway');
  const asked = new Date().toISOString();
  sendertoken.revoke('Midway');   // removed mid-request
  const t2 = agentToken('Midway');
  born('Midway Kid', 'Midway', { askedAt: asked, at: new Date(Date.now() + 1000).toISOString() });
  const r = await remove('midway-kid', { 'x-kosmos-agent-token': t2 });
  assert.equal(r.code, 403, 'a creator removed mid-request owned the member: ' + r.text.slice(0, 160));
  void t;
});

test('an agent made under a name a token already stood for (a live remote agent\'s) is not removable by its creator', async () => {
  born('Taken Name', 'pm-agent', { tookTokens: true });
  const r = await remove('taken-name', asAgent());
  assert.equal(r.code, 403);
  assert.match(r.text, NOT_YOURS);
});

test('removing a name whose key also holds another name\'s token is refused (revoke takes the whole key)', async () => {
  born('zedkip', 'pm-agent');
  assert.ok(reachedEngine(await remove('zedkip', asAgent())), 'CONTROL: no token under the key, and it did not pass');
  sendertoken.mint('zedkip');   // the target's own token, its exact name
  assert.ok(reachedEngine(await remove('zedkip', asAgent())), 'CONTROL: only its own exact-name token, and it did not pass');
  sendertoken.mint('Zed.Kip');  // a remote agent issued under another spelling with the same key
  const r = await remove('zedkip', asAgent());
  assert.equal(r.code, 403, 'removing zedkip would have ended Zed.Kip too: ' + r.text.slice(0, 160));
  assert.match(r.text, /would also end another agent's sign-in/, 'the refusal named the wrong reason: ' + r.text.slice(0, 160));
});

test('a target whose token file is there but unreadable is refused (it cannot be checked for another name)', async () => {
  born('Garbled Kid', 'pm-agent');
  assert.ok(reachedEngine(await remove('garbled-kid', asAgent())), 'CONTROL: no token file, and it did not pass');
  fs.mkdirSync(sendertoken.DIR, { recursive: true });
  fs.writeFileSync(path.join(sendertoken.DIR, store.safeKey('garbled-kid') + '.json'), '{not json');
  const r = await remove('garbled-kid', asAgent());
  assert.equal(r.code, 403, 'an unreadable token file was read as no other name: ' + r.text.slice(0, 160));
});

test('a history line whose time is not in toISOString form is read as an end (it cannot be ordered)', async () => {
  fs.mkdirSync(path.dirname(sendertoken.endedLogFile()), { recursive: true });
  born('Odd Time Kid', 'pm-agent');
  // A LATER time written with a space: as a string it sorts before the birth's 'T' form, so a plain compare misses it.
  const later = new Date(Date.now() + 60000).toISOString().replace('T', ' ');
  fs.appendFileSync(sendertoken.endedLogFile(), JSON.stringify({ name: 'odd-time-kid', at: later }) + '\n');
  const r = await remove('odd-time-kid', asAgent());
  assert.equal(r.code, 403, 'a line it could not order was read as no end: ' + r.text.slice(0, 160));
  born('Odd Birth Kid', 'pm-agent', { at: '2026-10-02 18:00' });
  assert.equal((await remove('odd-birth-kid', asAgent())).code, 403, 'a birth time it could not order was accepted');
});

test('a birth with no recorded board name (before #4475\'s slug field) is not honoured', async () => {
  born('Old Format Kid', 'pm-agent', { slug: undefined });
  const r = await remove('old-format-kid', asAgent());
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

test('a torn history line (an end not written whole) is read as an end, and the next end still lands on its own line', async () => {
  born('Torn Kid', 'pm-agent');
  assert.ok(reachedEngine(await remove('torn-kid', asAgent())), 'CONTROL: it passed before the torn line');
  fs.mkdirSync(path.dirname(sendertoken.endedLogFile()), { recursive: true });
  fs.appendFileSync(sendertoken.endedLogFile(), '{"name":"torn-k');   // a write cut off, with no newline after it
  const torn = await remove('torn-kid', asAgent());
  assert.equal(torn.code, 403, 'a torn line was skipped, so an end it may have held was lost');
  assert.match(torn.text, /could not check who made this agent/, 'a damaged history was reported as "not yours": ' + torn.text.slice(0, 160));
  sendertoken.revoke('next-after-torn');
  const lines = fs.readFileSync(sendertoken.endedLogFile(), 'utf8').split('\n');
  assert.ok(lines.some((l) => { try { return JSON.parse(l).name === 'next-after-torn'; } catch { return false; } }), 'the end written after a torn line was swallowed into it');
  // Leave the shared history whole again for the cases after this one (a torn line refuses every name).
  fs.writeFileSync(sendertoken.endedLogFile(), lines.filter((l) => { if (!l) return false; try { JSON.parse(l); return true; } catch { return false; } }).join('\n') + '\n');
});

test('a history that cannot be read refuses (last: it replaces the history file with a folder)', async () => {
  born('Unread Kid', 'pm-agent');
  assert.ok(reachedEngine(await remove('unread-kid', asAgent())), 'CONTROL: it passed while the history was readable');
  try { fs.rmSync(sendertoken.endedLogFile(), { force: true }); } catch { /* none yet */ }
  fs.mkdirSync(sendertoken.endedLogFile(), { recursive: true });
  const r = await remove('unread-kid', asAgent());
  assert.equal(r.code, 403, 'an unreadable history was read as no removals: ' + r.text.slice(0, 160));
  assert.match(r.text, /could not check who made this agent/, 'an unreadable history was reported as "not yours"');
});

test.after(() => {
  try { board.restore(); } catch { /* ignore */ }
  try { server.close(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});
