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
// A codex runner bin the create path treats as runnable under DRY_RUN, so a
// LABELLED OpenAI member can actually be created (the model-validation test).
process.env.AGENT_WORKFORCE_CODEX_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(os.tmpdir(), 'aw-team1279-claude-' + process.pid + '.json');
// A clean codex HOME (unset override) so a member on the DEFAULT OpenAI provider
// with no sign-in is a real dead account -- the deterministic dead arm. A
// LABELLED account (explicit dir, below) is driven separately for the model check.
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;

// A known DEFAULT Claude account (record beside ~/.claude), so accountConnectable
// resolves it and the only variable is what the faked live check answers.
fs.writeFileSync(path.join(HOME, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'default@example.com' } }));
fs.mkdirSync(path.join(HOME, '.claude', 'projects'), { recursive: true });
// A LABELLED OpenAI (codex apikey) account under the sandbox HOME, for the
// per-model validation test. Its key is fixed; the only variable is what
// openai.setFetcher makes /v1/models say. Same fixture shape as the #1329 e2e.
const OPENAI_DIR = path.join(HOME, '.codex-work');
fs.mkdirSync(OPENAI_DIR, { recursive: true });
fs.writeFileSync(path.join(OPENAI_DIR, 'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-workkeyworkkeyWORK' }));

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const create = require('./engine/create');
const openai = require('./engine/openaiaccounts');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  try { server.closeAllConnections(); server.close(); } catch { /* going away */ }
  create.setClaudeProbe(null);
  openai.setFetcher(null);
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

test('all members dead (no sign-in): no agent created; neutral summary, with the per-member sign-in remedy in refused[]', async () => {
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
    // Top-level summary is NEUTRAL (a member can be dead for a sign-in OR a model
    // reason, so the summary names neither), not "a team with no members".
    assert.match(r.json.because || '', /no member could be created/i, 'the all-dead summary should be neutral and point at refused[]');
    assert.doesNotMatch(r.json.because || '', /no members/i);
    assert.equal(r.json.refused.length, 2);
    // The specific remedy survives per-member: these were sign-in deaths.
    assert.match(r.json.refused[0].because || '', /sign-in|OpenAI sign-in/i, 'the per-member sign-in remedy should survive in refused[]');
    // Schema parity: this route-built response carries `cap` like every
    // createTeam-produced outcome does.
    assert.equal(typeof r.json.cap, 'number', 'the all-dead response should carry the cap field for schema consistency');
  } finally { create.setClaudeProbe(null); }
});

test('all members dead via UNRUNNABLE MODEL on live accounts: the summary is neutral and does NOT misname it as a sign-in failure', async () => {
  create.setClaudeProbe(LIVE);
  // Live OpenAI account that can run gpt-4o only; both members ask for a model it
  // cannot run, so both die for a MODEL reason, not a sign-in reason.
  openai.setFetcher(async () => ({ status: 200, body: { data: [{ id: 'gpt-4o' }] } }));
  try {
    const r = await postTeam({
      creator: 'pmboss', purpose: 'all bad model',
      members: [
        { name: 'badmodelone', role: 'pm', provider: 'openai', account: OPENAI_DIR, model: 'gpt-9-nonexistent' },
        { name: 'badmodeltwo', role: 'pm', provider: 'openai', account: OPENAI_DIR, model: 'gpt-9-alsonope' },
      ],
    });
    assert.equal(r.status, 400, JSON.stringify(r.json));
    assert.equal(r.json.outcome, 'refused', JSON.stringify(r.json));
    assert.equal(r.json.created.length, 0);
    // The bug this guards: a hardcoded "could not sign in" would point at the
    // WRONG remedy (re-authenticate) for a model failure. The summary must be
    // neutral, and the per-member reason must be the MODEL remedy.
    assert.doesNotMatch(r.json.because || '', /sign in|sign-in/i, 'a model-caused all-dead must NOT be misnamed a sign-in failure');
    assert.match(r.json.because || '', /no member could be created/i);
    assert.equal(r.json.refused.length, 2);
    assert.match(r.json.refused[0].because || '', /not a model this account can run/i, 'the per-member model remedy should survive in refused[]');
  } finally { create.setClaudeProbe(null); openai.setFetcher(null); }
});

test('all members dead AND a missing shape field: the higher-priority shape reason wins, not "could not sign in"', async () => {
  create.setClaudeProbe(LIVE);
  try {
    // Every member is dead (OpenAI, no sign-in) AND purpose is missing. createTeam
    // prioritizes the missing purpose over the members check, so the all-dead
    // early-return must NOT fire -- the route defers to that higher-priority
    // refusal rather than reporting a sign-in problem over a missing purpose.
    const r = await postTeam({
      creator: 'pmboss',
      members: [
        { name: 'deadnopurpa', role: 'pm', provider: 'openai' },
        { name: 'deadnopurpb', role: 'pm', provider: 'openai' },
      ],
    });
    assert.equal(r.status, 400, JSON.stringify(r.json));
    assert.equal(r.json.outcome, 'refused', JSON.stringify(r.json));
    assert.match(r.json.because || '', /stated purpose/i, 'the higher-priority missing-purpose reason must win over "could not sign in"');
    assert.doesNotMatch(r.json.because || '', /could not sign in/i);
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

test('a team needs a creator: the engine core\'s sentence, surfaced as 400', async () => {
  create.setClaudeProbe(LIVE);
  try {
    const r = await postTeam({ purpose: 'no creator here', members: [{ name: 'noboss', role: 'pm' }] });
    assert.equal(r.status, 400, JSON.stringify(r.json));
    assert.equal(r.json.outcome, 'refused', JSON.stringify(r.json));
    assert.match(r.json.because || '', /needs a creator/i);
    assert.ok(!birthOf('noboss'));
  } finally { create.setClaudeProbe(null); }
});

test('a non-object member entry is refused by shape, not created', async () => {
  create.setClaudeProbe(LIVE);
  try {
    const r = await postTeam({ creator: 'pmboss', purpose: 'bad member shape', members: [42] });
    assert.equal(r.status, 400, JSON.stringify(r.json));
    assert.equal(r.json.outcome, 'refused', JSON.stringify(r.json));
    assert.equal(r.json.refused.length, 1);
    assert.match(r.json.refused[0].because || '', /create spec object/i);
  } finally { create.setClaudeProbe(null); }
});

test('#2140 parity: an OpenAI member whose account cannot run the chosen model is refused (born-broken); a runnable one is created', async () => {
  create.setClaudeProbe(LIVE);
  // The labelled OpenAI account can run gpt-4o only. A member asking for it is
  // created; one asking for a model the account cannot run is refused BEFORE any
  // write -- the #2140/#2191 rail, at parity with POST /api/agents.
  openai.setFetcher(async () => ({ status: 200, body: { data: [{ id: 'gpt-4o' }] } }));
  try {
    const r = await postTeam({
      creator: 'pmboss', purpose: 'model parity',
      members: [
        { name: 'goodmodel', role: 'pm', provider: 'openai', account: OPENAI_DIR, model: 'gpt-4o' },
        { name: 'badmodel', role: 'pm', provider: 'openai', account: OPENAI_DIR, model: 'gpt-9-nonexistent' },
      ],
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.outcome, 'partial', JSON.stringify(r.json));
    assert.deepEqual(r.json.created.map((c) => c.name), ['goodmodel']);
    const bad = r.json.refused.find((x) => x.name === 'badmodel');
    assert.ok(bad, 'the unrunnable-model member was not refused: ' + JSON.stringify(r.json));
    assert.match(bad.because || '', /not a model this account can run/i);
    assert.ok(!birthOf('badmodel'), 'a born-broken model member reached createAgent');
    assert.ok(birthOf('goodmodel'), 'the runnable-model member should have been created');
  } finally { create.setClaudeProbe(null); openai.setFetcher(null); }
});

test('merge arithmetic under BOTH a createTeam per-member refusal AND a liveness refusal: X of Y counts the original total', async () => {
  create.setClaudeProbe(LIVE);
  try {
    // One live Claude member (created), one bad-name member (createTeam/createAgent
    // refuses it), one dead OpenAI member (liveness refuses it). The merged report
    // must be PARTIAL with created=1, refused=2, and the total counted as the
    // ORIGINAL 3 -- the arithmetic the merge path stresses hardest.
    const r = await postTeam({
      creator: 'pmboss', purpose: 'mixed three',
      members: [
        { name: 'goodthree', role: 'pm' },
        { name: 'bad name!', role: 'pm' },
        { name: 'deadthree', role: 'pm', provider: 'openai' },
      ],
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.outcome, 'partial', JSON.stringify(r.json));
    assert.deepEqual(r.json.created.map((c) => c.name), ['goodthree']);
    assert.equal(r.json.refused.length, 2, 'both the bad-name and the dead member should be refused: ' + JSON.stringify(r.json));
    const refusedNames = r.json.refused.map((x) => x.name);
    assert.ok(refusedNames.includes('deadthree'), 'the dead member is missing from refused[]');
    assert.match(r.json.because || '', /1 of 3 agents were created/, 'the total must be the ORIGINAL 3, not the post-liveness 2');
    assert.match(r.json.because || '', /2 were refused/);
    assert.ok(!birthOf('deadthree'), 'the dead member reached createAgent');
  } finally { create.setClaudeProbe(null); }
});

// ── #2972: the OPERATOR (board-token) path may raise the team cap in-flow via a
// `cap` in the request body, so a 15-20 person org-chart import works without the
// operator setting AGENT_WORKFORCE_TEAM_CAP out-of-band and restarting. postTeam
// posts with no agent token, so these exercise the operator path. Asserted at the
// refusal boundary (no real creates): the response echoes the RESOLVED cap, which
// is 12 if the override was ignored and the raised value if it took effect. ──
const many = (n) => Array.from({ length: n }, (_, i) => ({ name: 'capm' + i, role: 'pm' }));

test('#2972 operator raises the cap in-flow: body.cap lifts the effective per-team cap above the default 12', async () => {
  // 16 members with cap:15 -> still over 15, so refused WITHOUT any create, but the
  // refusal must name 15 (the raised cap), not 12. If body.cap were ignored the
  // resolved cap would be 12 (this is the mutation that reds the test).
  const r = await postTeam({ creator: 'operator', purpose: 'org-chart import of a big team', members: many(16), cap: 15 });
  assert.equal(r.status, 400, 'expected an over-(raised)-cap refusal: ' + JSON.stringify(r.json));
  assert.equal(r.json.cap, 15, 'the operator body.cap did not raise the effective cap: ' + JSON.stringify(r.json));
  assert.match(r.json.because || '', /16 agents/, 'the refusal must count the original 16');
  assert.match(r.json.because || '', /cap is 15/, 'the refusal must name the RAISED cap 15, not the default 12');
});

test('#2972 the raised cap is still clamped to MAX_TEAM_CAP (50): body.cap over 50 cannot exceed the ceiling', async () => {
  const r = await postTeam({ creator: 'operator', purpose: 'too ambitious', members: many(51), cap: 100 });
  assert.equal(r.status, 400, JSON.stringify(r.json));
  assert.equal(r.json.cap, 50, 'body.cap over MAX must clamp to 50, not pass through: ' + JSON.stringify(r.json));
  assert.match(r.json.because || '', /cap is 50/, 'the refusal must name the clamped ceiling 50');
});

test('#2972 an invalid body.cap is IGNORED (falls back to the default), never trusted blindly', async () => {
  for (const bad of ['abc', 0, -5, 15.5]) {
    const r = await postTeam({ creator: 'operator', purpose: 'bad cap', members: many(13), cap: bad });
    assert.equal(r.status, 400, 'a 13-member team should refuse at the default 12 for cap=' + JSON.stringify(bad) + ': ' + JSON.stringify(r.json));
    assert.equal(r.json.cap, 12, 'an invalid body.cap (' + JSON.stringify(bad) + ') must NOT change the cap; got ' + JSON.stringify(r.json.cap));
  }
});
