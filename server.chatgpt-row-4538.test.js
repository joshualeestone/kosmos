'use strict';
/*
 * #4538 (setup copied from server.chatgpt-green-4064.test.js): the ChatGPT row's STATE follows the same recorded answer
 * as its badge. #4064 made the badge outlast the live check's 30s cache; the row's state and reason stayed on that
 * cache, so a read after 30s said "unknown, we could not reach ChatGPT" beside "working" (measured on a real sign-in,
 * kosmos#4538). The handshake is faked through codexsigninlive.setRunner and the clock by stubbing Date.now; nothing
 * here reaches OpenAI.
 *
 * Original header of the copied setup:
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

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'srv-chatgpt-row-4538-'));
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
// A codex agent on the default codex home (configDir null), which is the ChatGPT sign-in above (as in
// server.openai-badge-2413.test.js): its observed successes badge that row.
const create = require('./engine/create');
fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
fs.mkdirSync(create.workerDir('codexsub'), { recursive: true });
fs.writeFileSync(create.plistPath('codexsub'), create.plistFor('codexsub', '/usr/bin/true', process.env.AGENT_WORKFORCE_TMUX_BIN, null, null, 'codex'), 'utf8');
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

test('#4538 forty seconds after a live answer, the row is connected, not "could not reach", while its check runs again', async () => {
  await recordGreen();
  let release;
  const gate = new Promise((r) => { release = r; });
  codexsigninlive.setRunner(async () => { await gate; return { ok: true, stdout: DOC('ok') }; });
  advanceClock(40 * 1000);   // past the check's 30s cache (the reads kosmos#4538 measured were 35 to 40s apart)
  try {
    const c = (await openaiRow()).connection;
    assert.equal(c.badge, 'working', 'setup: the recorded green did not show: ' + JSON.stringify(c));
    assert.equal(c.state, 'connected', 'the row contradicts its own badge: ' + JSON.stringify(c));
    assert.match(c.because, /reached ChatGPT/, 'the reason still says the check could not reach ChatGPT: ' + c.because);
    assert.doesNotMatch(c.because, /could not reach/);
    assert.equal(c.liveCheckPending, true, 'a green row whose check is running must still be read again (a dead answer can follow)');
  } finally { release(); await settle(); }
});

test('#4538 with no answer yet (a cold cache, nothing recorded), the row says it is checking, not that it could not reach ChatGPT', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  codexsigninlive.setRunner(async () => { await gate; return { ok: true, stdout: DOC('ok') }; });
  try {
    const c = (await openaiRow()).connection;
    assert.equal(c.state, 'unknown');
    assert.equal(c.liveCheckPending, true);
    assert.match(c.because, /checking/i, JSON.stringify(c));
    assert.doesNotMatch(c.because, /could not reach/);
    assert.equal(c.badge, undefined, 'nothing was recorded, so nothing may be green');
  } finally { release(); await settle(); }
  const after = (await openaiRow()).connection;
  assert.equal(after.state, 'connected', 'the check it started did not answer the next read: ' + JSON.stringify(after));
});

test('#4538 control: a check that ran and got no answer still says it could not reach ChatGPT, and is not green', async () => {
  codexsigninlive.setRunner(async () => ({ ok: false }));   // no report at all
  await accounts();
  await settle();
  const c = (await openaiRow()).connection;
  assert.equal(c.state, 'unknown');
  assert.match(c.because, /could not reach ChatGPT/, JSON.stringify(c));
  assert.notEqual(c.badge, 'working');
});

test('#4538 control: a dead answer after a recorded green is not connected (the lift never paints over a refusal)', async () => {
  await recordGreen();
  codexsigninlive.setRunner(async () => ({ ok: true, stdout: DOC('warning') }));   // handshake refused, endpoint reachable
  advanceClock(40 * 1000);
  await accounts();
  await settle();
  const c = (await openaiRow()).connection;
  assert.equal(c.state, 'none', JSON.stringify(c));
  assert.notEqual(c.badge, 'working');
});

test('#4538 an agent that reached ChatGPT recently makes the row connected too, and says the agent is why', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  codexsigninlive.setRunner(async () => { await gate; return { ok: true, stdout: DOC('ok') }; });
  observed.saw(observed.PROVIDER.OPENAI, 'codexsub', observed.OUTCOME.OK, Date.now());
  try {
    const c = (await openaiRow()).connection;
    assert.equal(c.badge, 'working', 'setup: the agent\'s success did not badge the row: ' + JSON.stringify(c));
    assert.equal(c.observedFrom, 'agent');
    assert.equal(c.state, 'connected', JSON.stringify(c));
    assert.match(c.because, /agent/);
  } finally { release(); await settle(); }
});

test('#4538 a dead answer is not undone by an older agent success once it leaves the check\'s 30s cache', async () => {
  observed.saw(observed.PROVIDER.OPENAI, 'codexsub', observed.OUTCOME.OK, Date.now() - 1000);   // the agent worked a second ago
  codexsigninlive.setRunner(async () => ({ ok: true, stdout: DOC('warning') }));   // then the check is refused: dead
  await accounts();
  await settle();
  const dead = (await openaiRow()).connection;
  assert.equal(dead.state, 'none', 'setup: the dead answer did not show: ' + JSON.stringify(dead));
  let release;
  const gate = new Promise((r) => { release = r; });
  codexsigninlive.setRunner(async () => { await gate; return { ok: true, stdout: DOC('warning') }; });
  advanceClock(40 * 1000);   // the dead answer has left the cache; the agent's success is still inside its 5 minutes
  try {
    const c = (await openaiRow()).connection;
    assert.notEqual(c.badge, 'working', 'the older agent success painted the row green again: ' + JSON.stringify(c));
    assert.notEqual(c.state, 'connected', JSON.stringify(c));
  } finally { release(); await settle(); }
});
