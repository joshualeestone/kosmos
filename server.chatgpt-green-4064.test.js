'use strict';
/*
 * #4064: a working ChatGPT sign-in flashed amber for about 3.5s on every reopen of AI Models, because its green lived
 * only in the live check's 30s cache. Its live answer is now recorded on its dir the way Grok's is (observed.sawDir),
 * so the green outlasts that cache for the observed freshness window, and a newer dead answer still wins (#3997).
 * The handshake is faked through codexsigninlive.setRunner and the clock is moved by stubbing Date.now; nothing here
 * reaches OpenAI or xAI. Setup copied from server.livecheck-3997.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'srv-chatgpt-green-4064-'));
const HOME = nodePath.join(SANDBOX, 'home');
for (const d of [HOME, nodePath.join(SANDBOX, 'data'), nodePath.join(SANDBOX, 'workers'), nodePath.join(SANDBOX, 'launch'), nodePath.join(SANDBOX, 'projects')]) {
  fs.mkdirSync(d, { recursive: true });
}
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_GROK_HOME = nodePath.join(HOME, '.grok');
process.env.AGENT_WORKFORCE_GEMINI_HOME = nodePath.join(HOME, '.gemini');
process.env.AGENT_WORKFORCE_TMUX_BIN = nodePath.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_GROK_CHECK_WAIT_MS = '200';   // round 7: how long the list waits on a Grok check
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;

const CODEX = nodePath.join(HOME, '.codex');
fs.mkdirSync(CODEX, { recursive: true });
const idPayload = Buffer.from(JSON.stringify({ email: 'sub@example.com' })).toString('base64url');
fs.writeFileSync(nodePath.join(CODEX, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: 'x.' + idPayload + '.y' } }));

// An API-KEY OpenAI account beside it: the ChatGPT Check now must refuse it (it is not a sign-in).
const CODEX_KEY = nodePath.join(HOME, '.codex-key');
fs.mkdirSync(CODEX_KEY, { recursive: true });
fs.writeFileSync(nodePath.join(CODEX_KEY, 'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-workingkeyworkingKEYX' }));

const codexsigninlive = require('./engine/codexsigninlive');
const openaiAccounts = require('./engine/openaiaccounts');
const grokAccounts = require('./engine/grokaccounts');
const observed = require('./engine/observed');
const { start, server } = require('./server');

const DOC = (ws) => JSON.stringify({ checks: {
  'network.websocket_reachability': { status: ws },
  'network.provider_reachability': { status: 'ok', details: { 'reachability mode': 'ChatGPT auth' } },
} });

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  codexsigninlive.resetForTest(); grokAccounts.setFetcher(null); openaiAccounts.setFetcher(null);
  try { server.close(); } catch { /* best effort */ }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});
/* Round 10: the API-key account below is checked against OpenAI's models listing on every read; answer it here, so
   nothing in this file ever reaches OpenAI (it sent a fake key there before). */
test.beforeEach(() => { codexsigninlive.resetForTest(); grokAccounts.setFetcher(null); grokAccounts.resetSubscriptionLiveForTest(); observed._clearForTest(); openaiAccounts.setFetcher(async () => ({ status: 200, body: { object: 'list', data: [] } })); });

const accounts = async () => ((await (await fetch(base + '/api/accounts')).json()).accounts || []);
const post = (p, obj) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });


const openaiRow = async () => (await accounts()).find((a) => a.provider === 'openai' && a.authMode === 'chatgpt');
const settle = () => new Promise((r) => setTimeout(r, 50));

/* Every clock read (the check's cache, the observed store, the overlay) jumps by `ms`, as reopening the screen that
   much later would see it. Restored after each test. */
const realNow = Date.now;
function advanceClock(ms) { const at = realNow() + ms; Date.now = () => at; }
test.afterEach(() => { Date.now = realNow; });

async function recordGreen() {
  codexsigninlive.setRunner(async () => ({ ok: true, stdout: DOC('ok') }));
  await accounts();
  await settle();
  const warm = await openaiRow();
  assert.equal(warm.connection.state, 'connected', 'setup: the first check did not confirm the sign-in ' + JSON.stringify(warm.connection));
}

test('#4064 a ChatGPT sign-in confirmed a minute ago is still green on reopen while its check runs again', async () => {
  await recordGreen();
  let release;
  const gate = new Promise((r) => { release = r; });
  let runs = 0;
  codexsigninlive.setRunner(async () => { runs++; await gate; return { ok: true, stdout: DOC('ok') }; });
  advanceClock(61 * 1000);   // past the check's 30s cache, well inside the 5 minute observed window
  try {
    const row = await openaiRow();
    assert.equal(runs, 1, 'reopening after the cache expired did not start a fresh check');
    assert.equal(row.connection.badge, 'working', 'the row went back to amber while its check re-ran: ' + JSON.stringify(row.connection));
    assert.ok(row.connection.observedAgeMs >= 60 * 1000, 'the green is not dated from the first check: ' + row.connection.observedAgeMs);
  } finally { release(); await settle(); }
});

test('#4064 decided: a check that gets no answer leaves a recent green standing (unknown changes nothing, as for Grok)', async () => {
  await recordGreen();
  codexsigninlive.setRunner(async () => ({ ok: false }));   // codex could not reach ChatGPT: no report at all
  advanceClock(61 * 1000);
  await accounts();
  await settle();
  const row = await openaiRow();
  assert.equal(row.connection.state, 'unknown', 'setup: the re-check did not come back without an answer');
  assert.equal(row.connection.badge, 'working', 'a check with no answer took away a green confirmed a minute ago: ' + JSON.stringify(row.connection));
});

test('#4064 control: a dead answer after a recorded green shows the sign-in as not connected, not green', async () => {
  await recordGreen();
  codexsigninlive.setRunner(async () => ({ ok: true, stdout: DOC('warning') }));
  advanceClock(61 * 1000);
  await accounts();          // starts the fresh check, which answers dead
  await settle();
  const row = await openaiRow();
  assert.equal(row.connection.state, 'none', JSON.stringify(row.connection));
  assert.notEqual(row.connection.badge, 'working', 'an older recorded green painted over a newer dead answer');
  /* And the green was FORGOTTEN, not merely outvoted while the dead answer is cached: once that answer's own 30s cache
     has gone too (the first green is still inside the observed window), reopening must not bring the green back. */
  let release;
  const gate = new Promise((r) => { release = r; });
  codexsigninlive.setRunner(async () => { await gate; return { ok: true, stdout: DOC('warning') }; });
  advanceClock(61 * 1000 + 31 * 1000);
  try {
    const later = await openaiRow();
    assert.notEqual(later.connection.badge, 'working', 'the green recorded before the dead answer came back once that answer aged out of its cache');
  } finally { release(); await settle(); }
});

test('#4064 a Check now that answers live keeps the row green a minute later, with nobody reading the list in between', async () => {
  codexsigninlive.setRunner(async () => ({ ok: true, stdout: DOC('ok') }));
  const j = await (await post('/api/accounts/openai/check', { dir: CODEX })).json();
  assert.equal(j.state, 'connected', 'setup: Check now did not answer live');
  let release;
  const gate = new Promise((r) => { release = r; });
  codexsigninlive.setRunner(async () => { await gate; return { ok: true, stdout: DOC('ok') }; });
  advanceClock(61 * 1000);
  try {
    const row = await openaiRow();
    assert.equal(row.connection.badge, 'working', 'the green Check now confirmed was not kept: ' + JSON.stringify(row.connection));
  } finally { release(); await settle(); }
});

test('#4064 control: a Check now that answers dead forgets the green without anyone reading the list', async () => {
  await recordGreen();
  codexsigninlive.setRunner(async () => ({ ok: true, stdout: DOC('warning') }));
  advanceClock(40 * 1000);
  const j = await (await post('/api/accounts/openai/check', { dir: CODEX })).json();
  assert.equal(j.state, 'none', 'setup: Check now did not answer dead');
  // Nobody reads the list until that dead answer has left its own 30s cache; the reopen's check then has no answer.
  let release;
  const gate = new Promise((r) => { release = r; });
  codexsigninlive.setRunner(async () => { await gate; return { ok: false }; });
  advanceClock(40 * 1000 + 31 * 1000);
  try {
    const row = await openaiRow();
    assert.notEqual(row.connection.badge, 'working', 'the green from before Check now answered dead came back');
  } finally { release(); await settle(); }
});

test('#4064 control: a subscription the offline check finds lapsed is not painted green by a recorded check', async () => {
  const good = fs.readFileSync(nodePath.join(CODEX, 'auth.json'));
  await recordGreen();
  const lapsed = { email: 'sub@example.com', exp: Math.floor(Date.now() / 1000) + 3600,
    'https://api.openai.com/auth': { chatgpt_subscription_active_until: new Date(Date.now() - 86400 * 1000).toISOString() } };
  fs.writeFileSync(nodePath.join(CODEX, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt',
    tokens: { id_token: 'x.' + Buffer.from(JSON.stringify(lapsed)).toString('base64url') + '.y' } }));
  try {
    const row = await openaiRow();
    assert.equal(row.connection.state, 'none', 'setup: the lapse was not found ' + JSON.stringify(row.connection));
    assert.notEqual(row.connection.badge, 'working', 'a recorded check green painted a lapsed subscription green');
  } finally { fs.writeFileSync(nodePath.join(CODEX, 'auth.json'), good); }
});

test('#4064 control: an API-key account is not painted by a recorded check answer on its folder', async () => {
  // Seed the case the gate exists for: a live answer cached (and so recorded) on the API-KEY folder.
  codexsigninlive.setRunner(async () => ({ ok: true, stdout: DOC('ok') }));
  assert.equal(await codexsigninlive.liveness(CODEX_KEY), 'live');
  assert.ok(observed.readDir(observed.PROVIDER.OPENAI, CODEX_KEY), 'setup: nothing recorded on the API-key folder');
  const keyRow = (await accounts()).find((a) => a.provider === 'openai' && a.authMode !== 'chatgpt');
  assert.ok(keyRow, 'setup: no API-key row listed');
  assert.notEqual(keyRow.connection.badge, 'working', 'an API-key row was painted from a check answer: ' + JSON.stringify(keyRow.connection));
});

/* #4139: a ChatGPT green that came from the free check says so, so the page does not claim an agent's request. */
test('#4139 a ChatGPT green from the free check names the check as its source', async () => {
  await recordGreen();
  const row = await openaiRow();
  assert.equal(row.connection.badge, 'working', 'CONTROL: ' + JSON.stringify(row.connection));
  assert.equal(row.connection.observedFrom, 'check', JSON.stringify(row.connection));
});
