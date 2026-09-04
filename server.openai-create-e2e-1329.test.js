'use strict';
/**
 * #1329 / #1903 (OpenAI arm) — the OpenAI create path, driven END TO END through
 * the real POST /api/agents route.
 *
 * 🛑 WHY THIS EXISTS. #1903's create-time liveness gate (create.accountConnectable)
 * has UNIT coverage for the OpenAI arm (engine/create.account-connectable-1903.test.js
 * calls the gate directly), and server.create-live-1903.test.js drives the ROUTE but
 * only for the CLAUDE arm. Nothing proved the OpenAI arm through the actual route:
 * request -> gate -> (refuse | createAgent). This does, for all three credential
 * verdicts, and it makes the #1906 FAIL-OPEN arm explicit rather than incidental.
 *
 * 🔑 THE DANGEROUS-ANSWER ARM (Splinter, 2026-09-03). #1906 refuses only a
 * POSITIVELY-dead sign-in (checkLive state NONE == an absent auth file or OpenAI's
 * own `invalid_api_key`). An UNREACHABLE check at create (network blip, timeout)
 * maps to UNKNOWN and FAILS OPEN — the agent is created. codex does NO credential
 * re-check at its first turn (mapped 2026-09-03: bin/agent-supervisor.sh launches
 * codex raw), so an unreachable-at-create-but-actually-DEAD credential is created
 * and 401s on turn 1 — the exact original symptom, for the uncommon case #1906 does
 * not cover. This test PINS that behaviour so it is a known, documented residual and
 * not a surprise; the turn-1 surfacing fix (make a running agent's 401 read as
 * `auth_failed`) is a running-agent liveness read, filed as a follow-up in the state
 * layer (Renet, #2019), NOT create-time work.
 *
 * The one faked boundary is OpenAI's `/v1/models` call via openaiaccounts.setFetcher
 * (the module's own seam); no credential value is written or asserted. Sandboxes
 * every root + DRY_RUN + fake bins so no launchd job or tmux write escapes.
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-openai-create-e2e-1329-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
// A codex runner bin the create path treats as runnable; /bin/echo is enough under DRY_RUN.
process.env.AGENT_WORKFORCE_CODEX_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
// #1903's default-openai fail-open guard checks codexHomeOverridden(); a LABELLED
// account (explicit dir) has no such ambiguity, so keep the codex home unset and
// drive a labelled account, which is where the real gate runs.
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;

// A default Claude account so the board/roster machinery has a normal baseline, and a
// LABELLED OpenAI (codex apikey) account we drive the create against. The account's
// key is fixed; the ONLY variable across cells is what setFetcher makes /v1/models say.
fs.writeFileSync(path.join(HOME, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'default@example.com' } }));
fs.mkdirSync(path.join(HOME, '.claude', 'projects'), { recursive: true });
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
  openai.setFetcher(null);
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

async function post(body) {
  const res = await fetch(base + '/api/agents', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  let json = null; try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}
const born = (name) => create.createdLog().some((e) => e.name === name);

test('CONTROL: the labelled OpenAI account is actually listed, and no real account leaked in', () => {
  const dirs = openai.list().map((a) => a.dir);
  assert.ok(dirs.some((d) => d.indexOf('.codex-work') !== -1), 'the fixture OpenAI account is not listed: ' + JSON.stringify(dirs));
  for (const d of dirs) assert.ok(d.startsWith(SANDBOX), 'a real OpenAI account leaked into the fixture: ' + d);
});

test('OpenAI DEAD (OpenAI answers invalid_api_key) is REFUSED at create, names the remedy, and makes no agent', async () => {
  openai.setFetcher(async () => ({ status: 401, body: { error: { code: 'invalid_api_key' } } }));
  try {
    const r = await post({ name: 'oai-dead', role: 'pm', provider: 'openai', account: OPENAI_DIR });
    assert.equal(r.status, 400, 'a create on a dead OpenAI account was not refused: ' + JSON.stringify(r.json));
    assert.match((r.json && r.json.error) || '', /sign-in is not working/);
    // The gate returned BEFORE createAgent: no birth was recorded for this name.
    assert.ok(!born('oai-dead'), 'the refused OpenAI create still reached createAgent (a birth was recorded)');
  } finally { openai.setFetcher(null); }
});

test('OpenAI LIVE (OpenAI answers 200) passes the gate and reaches createAgent', async () => {
  openai.setFetcher(async () => ({ status: 200, body: { data: [{ id: 'gpt-4o' }] } }));
  try {
    const r = await post({ name: 'oai-live', role: 'pm', provider: 'openai', account: OPENAI_DIR });
    assert.doesNotMatch((r.json && r.json.error) || '', /sign-in is not working/,
      'a live OpenAI account was refused by the liveness gate: ' + JSON.stringify(r.json));
    assert.ok(born('oai-live'), 'a live OpenAI create did not reach createAgent: ' + JSON.stringify(r.json));
  } finally { openai.setFetcher(null); }
});

test('THE FAIL-OPEN ARM: an UNREACHABLE check at create is NOT refused (fails open), so the agent is created', async () => {
  // Splinter's dangerous-answer cell. setFetcher throws -> askModels reports unreachable
  // -> checkLive returns UNKNOWN (not NONE) -> accountConnectable returns ok:true.
  openai.setFetcher(async () => { throw new Error('network down at create'); });
  try {
    const r = await post({ name: 'oai-unreachable', role: 'pm', provider: 'openai', account: OPENAI_DIR });
    assert.doesNotMatch((r.json && r.json.error) || '', /sign-in is not working/,
      'an UNREACHABLE check was treated as a dead account (it must fail OPEN, never block a legit account): ' + JSON.stringify(r.json));
    assert.ok(born('oai-unreachable'), 'the fail-open create did not reach createAgent: ' + JSON.stringify(r.json));
    /* 🛑 DOCUMENTED RESIDUAL (#1906 fail-open, characterized for #1329). This created
       agent is exactly the risk: if the credential that could not be reached at create
       is ACTUALLY dead, the agent 401s on its FIRST turn (codex does no turn-1 re-check).
       The fail-open is deliberate — an unreachable check must never block a legitimate
       account on a network blip — so the fix is NOT to refuse here; it is to surface the
       turn-1 401 as `auth_failed` ("Sign-in isn't working") on the running agent. That is
       a running-agent liveness read, filed as a follow-up in the state layer (#2019, Renet),
       not create-time work. This assertion pins the fail-open so a future change that starts
       REFUSING unreachable checks (blocking legit accounts) is caught here. */
  } finally { openai.setFetcher(null); }
});

test('#1329 pre-existing-agents cell: the gate + create behave identically with agents already born', async () => {
  // By now oai-live exists (created above), so this create happens on a NON-empty board /
  // roster — the "pre-existing agents" axis of #1329, as opposed to the first-agent-ever path.
  assert.ok(born('oai-live'), 'precondition: an agent should already exist from an earlier cell');
  // Dead is still refused with agents present...
  openai.setFetcher(async () => ({ status: 401, body: { error: { code: 'invalid_api_key' } } }));
  try {
    const r = await post({ name: 'oai-dead-2', role: 'pm', provider: 'openai', account: OPENAI_DIR });
    assert.equal(r.status, 400, 'a dead OpenAI create was not refused with pre-existing agents: ' + JSON.stringify(r.json));
    assert.ok(!born('oai-dead-2'), 'the refused create reached createAgent (pre-existing-agents cell)');
  } finally { openai.setFetcher(null); }
  // ...and live still creates.
  openai.setFetcher(async () => ({ status: 200, body: { data: [{ id: 'gpt-4o' }] } }));
  try {
    const r = await post({ name: 'oai-live-2', role: 'pm', provider: 'openai', account: OPENAI_DIR });
    assert.doesNotMatch((r.json && r.json.error) || '', /sign-in is not working/,
      'a live OpenAI create was refused with pre-existing agents: ' + JSON.stringify(r.json));
    assert.ok(born('oai-live-2'), 'a live OpenAI create with pre-existing agents did not reach createAgent');
  } finally { openai.setFetcher(null); }
});
