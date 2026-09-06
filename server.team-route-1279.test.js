'use strict';
/**
 * #1279, driven through the real POST /api/team route.
 *
 * The engine core (engine/team.createTeam + the Kosmos-owned cap + creation
 * provenance) merged in #2247 with its own unit tests. THIS proves the AUTHORING
 * SEAM end to end: a team spec posted to the route builds several agents at once,
 * each birth record carrying who asked for them (creator) and why (purpose), the
 * whole request bounded by the cap, and a member whose account cannot sign in
 * refused by the same #1903 liveness rail POST /api/agents added -- before any
 * agent is written -- rather than producing an agent that 401s on its first turn.
 *
 * 🛑 Sandboxes every root the create path writes to (the fixture-discipline
 * rule), and DRY_RUN + fake bins so no launchd job or tmux write escapes. The one
 * faked boundary is Claude's real `claude -p` liveness call via
 * create.setClaudeProbe (the module's own seam, #1916); the OpenAI-dead arm needs
 * no fake -- an empty sandbox simply has no OpenAI sign-in, which is a real dead
 * account by construction.
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-team-route-1279-'));
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
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(os.tmpdir(), 'aw-team1279-claude-' + process.pid + '.json');
// A clean sandbox has no codex home, so openaiaccounts.list() is empty and a
// member created "on OpenAI" is a real dead account -- the deterministic dead arm.
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;

// A known DEFAULT Claude account (record beside ~/.claude), so accountConnectable
// resolves it and the only variable is what the faked live check answers.
fs.writeFileSync(path.join(HOME, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'default@example.com' } }));
fs.mkdirSync(path.join(HOME, '.claude', 'projects'), { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const create = require('./engine/create');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  try { server.closeAllConnections(); server.close(); } catch { /* going away */ }
  create.setClaudeProbe(null);
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

async function postTeam(body) {
  const res = await fetch(base + '/api/team', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  let json = null; try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

const LIVE = async () => ({ exitCode: 0, out: 'ok' });

function birthOf(name) {
  return create.createdLog().filter((e) => e && e.name === name).pop() || null;
}

test('happy path: a team of live-account members is CREATED, and every member records creator + purpose', async () => {
  create.setClaudeProbe(LIVE);
  try {
    const r = await postTeam({
      creator: 'pmboss', purpose: 'ship the thing',
      members: [{ name: 'teamone', role: 'pm' }, { name: 'teamtwo', role: 'pm' }],
    });
    assert.equal(r.status, 200, 'a live-account team was not created: ' + JSON.stringify(r.json));
    assert.equal(r.json.outcome, 'created', 'outcome was not created: ' + JSON.stringify(r.json));
    assert.equal(r.json.created.length, 2, 'both members should be created: ' + JSON.stringify(r.json));
    assert.deepEqual(r.json.created.map((c) => c.name).sort(), ['teamone', 'teamtwo']);
    // Provenance is the whole point of the feature: the birth record answers WHO
    // and WHY, not just WHAT.
    for (const name of ['teamone', 'teamtwo']) {
      const b = birthOf(name);
      assert.ok(b, 'no birth record for ' + name);
      assert.equal(b.createdBy, 'pmboss', name + ' did not record its creator');
      assert.equal(b.purpose, 'ship the thing', name + ' did not record the purpose');
    }
  } finally { create.setClaudeProbe(null); }
});

test('provenance cannot be forged by a member: the TEAM is the authority on creator + purpose', async () => {
  create.setClaudeProbe(LIVE);
  try {
    const r = await postTeam({
      creator: 'realboss', purpose: 'the real purpose',
      members: [{ name: 'forger', role: 'pm', createdBy: 'evil', purpose: 'evil purpose' }],
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.outcome, 'created', JSON.stringify(r.json));
    const b = birthOf('forger');
    assert.ok(b, 'no birth record for forger');
    assert.equal(b.createdBy, 'realboss', "a member overwrote the team's creator");
    assert.equal(b.purpose, 'the real purpose', "a member overwrote the team's purpose");
  } finally { create.setClaudeProbe(null); }
});

test('#1903 rail: a member on a dead account is refused BEFORE any write; live members still created (PARTIAL)', async () => {
  create.setClaudeProbe(LIVE); // the Claude member is live; the OpenAI member is dead by empty-sandbox construction
  try {
    const r = await postTeam({
      creator: 'pmboss', purpose: 'mixed team',
      members: [
        { name: 'livemember', role: 'pm' },
        { name: 'deadmember', role: 'pm', provider: 'openai' },
      ],
    });
    assert.equal(r.status, 200, 'a partial team should be 200 (something was made): ' + JSON.stringify(r.json));
    assert.equal(r.json.outcome, 'partial', JSON.stringify(r.json));
    assert.deepEqual(r.json.created.map((c) => c.name), ['livemember']);
    const refusedNames = r.json.refused.map((x) => x.name);
    assert.ok(refusedNames.includes('deadmember'), 'the dead-account member was not refused: ' + JSON.stringify(r.json));
    const deadEntry = r.json.refused.find((x) => x.name === 'deadmember');
    assert.match(deadEntry.because || '', /OpenAI sign-in|could not run/i, 'the refusal did not name the dead sign-in');
    // AND the dead member never reached createAgent -- no birth was recorded for it.
    assert.ok(!birthOf('deadmember'), 'the dead-account member still reached createAgent (a birth was recorded)');
    assert.ok(birthOf('livemember'), 'the live member should have been created');
  } finally { create.setClaudeProbe(null); }
});

test('all members dead: no agent is created, and the reason names the sign-in, not an empty team', async () => {
  create.setClaudeProbe(LIVE);
  try {
    const r = await postTeam({
      creator: 'pmboss', purpose: 'all dead',
      members: [
        { name: 'deadone', role: 'pm', provider: 'openai' },
        { name: 'deadtwo', role: 'pm', provider: 'openai' },
      ],
    });
    assert.equal(r.status, 400, JSON.stringify(r.json));
    assert.equal(r.json.outcome, 'refused', JSON.stringify(r.json));
    assert.equal(r.json.created.length, 0);
    assert.match(r.json.because || '', /could not sign in/i, 'the all-dead reason should name the sign-in, not "a team with no members"');
    assert.doesNotMatch(r.json.because || '', /no members/i);
    assert.equal(r.json.refused.length, 2);
    // Schema parity: this route-built response carries `cap` like every
    // createTeam-produced outcome does.
    assert.equal(typeof r.json.cap, 'number', 'the all-dead response should carry the cap field for schema consistency');
  } finally { create.setClaudeProbe(null); }
});

test('over-cap + dead members: refused for the cap with the honest ORIGINAL count, and the cap reason is NOT clobbered by liveness detail', async () => {
  create.setClaudeProbe(LIVE);
  try {
    // 13 members (> default cap 12), a mix of live Claude and dead OpenAI. The
    // cap gate must fire on the ORIGINAL 13 BEFORE any liveness sweep, so the
    // dead members are never checked and the refusal names the cap, not a
    // sign-in -- the exact clobber the merge-guard prevents.
    const members = [];
    for (let i = 0; i < 10; i++) members.push({ name: 'mixlive' + i, role: 'pm' });
    for (let i = 0; i < 3; i++) members.push({ name: 'mixdead' + i, role: 'pm', provider: 'openai' });
    const r = await postTeam({ creator: 'pmboss', purpose: 'over cap with dead', members });
    assert.equal(r.status, 400, JSON.stringify(r.json));
    assert.equal(r.json.outcome, 'refused', JSON.stringify(r.json));
    assert.match(r.json.because || '', /13 agents/, 'the cap refusal must count the ORIGINAL 13, not a liveness-reduced subset');
    assert.match(r.json.because || '', /cap is 12/, 'the cap refusal must name the bound');
    assert.doesNotMatch(r.json.because || '', /sign-in|were created/i, 'the true cap reason was clobbered by liveness/merge detail');
    // createTeam refuseAll never populates refused[]; the dead members must NOT
    // have leaked into it (proof the liveness sweep was skipped for an over-cap request).
    assert.equal(r.json.refused.length, 0, 'a whole-request cap refusal must not list per-member refusals');
    assert.ok(!create.createdLog().some((e) => e && /^mix(live|dead)\d+$/.test(e.name)), 'an over-cap request created agents');
  } finally { create.setClaudeProbe(null); }
});

test('whole-request shape refusal (missing purpose) is NOT clobbered when liveness also filtered a dead member', async () => {
  create.setClaudeProbe(LIVE);
  try {
    // Under cap, missing purpose, one live + one dead. Liveness filters the dead
    // one, createTeam refuses the whole request for the missing purpose. The
    // real reason must survive -- not be replaced by "0 of 2 agents were created".
    const r = await postTeam({
      creator: 'pmboss',
      members: [{ name: 'shapelive', role: 'pm' }, { name: 'shapedead', role: 'pm', provider: 'openai' }],
    });
    assert.equal(r.status, 400, JSON.stringify(r.json));
    assert.equal(r.json.outcome, 'refused', JSON.stringify(r.json));
    assert.match(r.json.because || '', /stated purpose/i, 'the shape reason was clobbered by liveness/merge detail');
    assert.doesNotMatch(r.json.because || '', /agents were created/i, 'a whole-request shape refusal must not report a per-member tally');
    assert.ok(!birthOf('shapelive'), 'a shape-refused team should create nothing');
  } finally { create.setClaudeProbe(null); }
});

test('the Kosmos-owned cap refuses a runaway team (more than the default cap), and names the bound', async () => {
  create.setClaudeProbe(LIVE);
  try {
    const members = [];
    for (let i = 0; i < 13; i++) members.push({ name: 'capm' + i, role: 'pm' });
    const r = await postTeam({ creator: 'pmboss', purpose: 'too big', members });
    assert.equal(r.status, 400, JSON.stringify(r.json));
    assert.equal(r.json.outcome, 'refused', JSON.stringify(r.json));
    assert.equal(r.json.created.length, 0, 'nothing should be created when the request is refused for the cap');
    assert.match(r.json.because || '', /cap is 12|run away/i, 'the cap refusal did not name the bound');
    // AND no agent was created despite 13 live members -- the cap refused the request whole.
    assert.ok(!create.createdLog().some((e) => e && /^capm\d+$/.test(e.name)),
      'a capped-out request still created agents');
  } finally { create.setClaudeProbe(null); }
});

test('shape refusal is the engine core\'s own sentence, surfaced as 400: a team needs a stated purpose', async () => {
  create.setClaudeProbe(LIVE);
  try {
    const r = await postTeam({ creator: 'pmboss', members: [{ name: 'nopurp', role: 'pm' }] });
    assert.equal(r.status, 400, JSON.stringify(r.json));
    assert.equal(r.json.outcome, 'refused', JSON.stringify(r.json));
    assert.match(r.json.because || '', /stated purpose/i);
    assert.ok(!birthOf('nopurp'), 'a shape-refused team should create nothing');
  } finally { create.setClaudeProbe(null); }
});
