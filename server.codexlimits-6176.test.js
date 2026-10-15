'use strict';
/*
 * #6176 slice 2: a ChatGPT sign-in (OpenAI) row in GET /api/accounts carries its plan limits as Codex last reported
 * them in its own session files; an API-key row carries none. Setup copied from server.chatgpt-row-4538.test.js: the
 * ChatGPT check is faked through codexsigninlive.setRunner and the key check through openaiAccounts.setFetcher, so
 * nothing here reaches OpenAI.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'srv-codexlimits-6176-'));
const HOME = nodePath.join(SANDBOX, 'home');
for (const d of [HOME, nodePath.join(SANDBOX, 'data'), nodePath.join(SANDBOX, 'workers'), nodePath.join(SANDBOX, 'launch'), nodePath.join(SANDBOX, 'projects')]) {
  fs.mkdirSync(d, { recursive: true });
}
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = nodePath.join(process.env.AGENT_WORKFORCE_LAUNCH, 'systemd', 'user');
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_GROK_HOME = nodePath.join(HOME, '.grok');
process.env.AGENT_WORKFORCE_GEMINI_HOME = nodePath.join(HOME, '.gemini');
process.env.AGENT_WORKFORCE_TMUX_BIN = nodePath.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_GROK_CHECK_WAIT_MS = '200';
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;

const CODEX = nodePath.join(HOME, '.codex');
fs.mkdirSync(CODEX, { recursive: true });
const idPayload = Buffer.from(JSON.stringify({ email: 'sub@example.com' })).toString('base64url');
fs.writeFileSync(nodePath.join(CODEX, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: 'x.' + idPayload + '.y', account_id: 'acct-sub' } }));
{ const t = new Date(Date.now() - 3 * 3600e3); fs.utimesSync(nodePath.join(CODEX, 'auth.json'), t, t); }   // signed in three hours ago
const CODEX_KEY = nodePath.join(HOME, '.codex-key');
fs.mkdirSync(CODEX_KEY, { recursive: true });
fs.writeFileSync(nodePath.join(CODEX_KEY, 'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-workingkeyworkingKEYX' }));

// A Codex agent on the default Codex home (configDir null), which is the ChatGPT sign-in above. Since #4592 its sessions
// go to its own private home (codexruntime.forAgent), not the account's.
const jobfix = require('./test-support/jobfixture');
const create = require('./engine/create');
fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
fs.mkdirSync(create.workerDir('codexsub'), { recursive: true });
fs.writeFileSync(jobfix.jobPath('codexsub'), jobfix.jobFor('codexsub', '/usr/bin/true', process.env.AGENT_WORKFORCE_TMUX_BIN, null, null, 'codex'), 'utf8');
require('./engine/store').writeProfile('codexsub', { role: 'writer' });   // registered, so the board knows it when it is not running
// A second ChatGPT sign-in, with its own agent, and an agent on the API-key account: each must reach only its own row.
const CODEX_WORK = nodePath.join(HOME, '.codex-work');
fs.mkdirSync(CODEX_WORK, { recursive: true });
fs.writeFileSync(nodePath.join(CODEX_WORK, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: 'x.' + Buffer.from(JSON.stringify({ email: 'work@example.com' })).toString('base64url') + '.y', account_id: 'acct-work' } }));
for (const [name, dir] of [['codexwork', CODEX_WORK], ['codexkey', CODEX_KEY]]) {
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(jobfix.jobPath(name), jobfix.jobFor(name, '/usr/bin/true', process.env.AGENT_WORKFORCE_TMUX_BIN, null, dir, 'codex'), 'utf8');
  require('./engine/store').writeProfile(name, { role: 'writer' });
}
{ const t = new Date(Date.now() - 3 * 3600e3); fs.utimesSync(nodePath.join(CODEX_WORK, 'auth.json'), t, t); }

/* Signs the folder in again under another login (a different account_id, written now); returns a function that puts the
   original back, contents and time. */
function relogin(dir) {
  const auth = nodePath.join(dir, 'auth.json'), body = fs.readFileSync(auth, 'utf8'), t0 = fs.statSync(auth).mtime;
  const j = JSON.parse(body); j.tokens.account_id = 'acct-other-login';
  fs.writeFileSync(auth, JSON.stringify(j));
  return () => { fs.writeFileSync(auth, body); fs.utimesSync(auth, t0, t0); };
}
// Each agent has been on its account for a while: its job was last written two hours ago (a move would rewrite it).
for (const n of ['codexsub', 'codexwork', 'codexkey']) { const t = new Date(Date.now() - 2 * 3600e3); fs.utimesSync(jobfix.jobPath(n), t, t); }
const codexruntime = require('./engine/codexruntime');
const codexsigninlive = require('./engine/codexsigninlive');
const openaiAccounts = require('./engine/openaiaccounts');
const grokAccounts = require('./engine/grokaccounts');
const { start, server } = require('./server');

const DOC = JSON.stringify({ checks: { 'network.websocket_reachability': { status: 'ok' }, 'network.provider_reachability': { status: 'ok', details: { 'reachability mode': 'ChatGPT auth' } } } });
let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  codexsigninlive.resetForTest(); grokAccounts.setFetcher(null); openaiAccounts.setFetcher(null);
  try { server.close(); } catch { /* best effort */ }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});
test.beforeEach(() => {
  codexsigninlive.resetForTest(); codexsigninlive.setRunner(async () => ({ ok: true, stdout: DOC }));
  openaiAccounts.setFetcher(async () => ({ status: 200, body: { object: 'list', data: [] } }));
});
const rows = async () => ((await (await fetch(base + '/api/accounts')).json()).accounts || []);

function writeReport(home, isoAt, primary, secondary) {
  const dir = nodePath.join(home, 'sessions', '2026', '10', '14');
  fs.mkdirSync(dir, { recursive: true });
  const row = { timestamp: isoAt, type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: { limit_id: 'codex', primary, secondary, plan_type: 'prolite' } } };
  fs.writeFileSync(nodePath.join(dir, 'rollout-2026-10-14T10-00-00-abc.jsonl'), JSON.stringify(row) + '\n');
}

test('#6176 a ChatGPT row carries its limits in ms; an API-key row carries none', async () => {
  const soon = Math.floor(Date.now() / 1000) + 3600, week = Math.floor(Date.now() / 1000) + 3 * 86400, at = new Date(Date.now() - 120e3).toISOString();
  writeReport(CODEX, at, { used_percent: 64, window_minutes: 300, resets_at: soon }, { used_percent: 30, window_minutes: 10080, resets_at: week });
  writeReport(CODEX_KEY, at, { used_percent: 99, window_minutes: 300, resets_at: soon }, null);   // a key's home: never read
  const all = await rows();
  const sub = all.find((a) => a.provider === 'openai' && a.authMode === 'chatgpt');
  const key = all.find((a) => a.provider === 'openai' && a.authMode === 'apikey');
  assert.ok(sub, 'the ChatGPT row is not listed: ' + JSON.stringify(all.map((a) => [a.provider, a.authMode])));
  assert.deepEqual(sub.limits, {
    windows: [{ usedPct: 64, windowMinutes: 300, resetsAt: soon * 1000 }, { usedPct: 30, windowMinutes: 10080, resetsAt: week * 1000 }],
    plan: 'prolite', at: Date.parse(at),
  });
  assert.ok(key, 'the API-key row is not listed');
  assert.equal('limits' in key, false, 'an API key has no plan limits, so its row carries no limits field');
});

test('#6176 a report written only in an agent\'s private Codex home reaches its account\'s row', async () => {
  fs.rmSync(nodePath.join(CODEX, 'sessions'), { recursive: true, force: true });   // nothing in the account folder itself
  const priv = codexruntime.forAgent('codexsub');
  const week = Math.floor(Date.now() / 1000) + 3 * 86400, at = new Date(Date.now() - 60e3).toISOString();
  writeReport(priv, at, { used_percent: 41, window_minutes: 10080, resets_at: week }, null);
  const sub = (await rows()).find((a) => a.provider === 'openai' && a.authMode === 'chatgpt');
  assert.ok(sub && sub.limits, 'the private home was not read: ' + JSON.stringify(sub && sub.limits));
  assert.equal(sub.limits.windows[0].usedPct, 41);
  fs.rmSync(nodePath.join(priv, 'sessions'), { recursive: true, force: true });
});

test('#6176 each private home reaches only its own account: a named sign-in\'s agent, and none from the key account', async () => {
  for (const d of [CODEX, CODEX_WORK]) fs.rmSync(nodePath.join(d, 'sessions'), { recursive: true, force: true });
  const week = Math.floor(Date.now() / 1000) + 3 * 86400, at = new Date(Date.now() - 30e3).toISOString();
  writeReport(codexruntime.forAgent('codexwork'), at, { used_percent: 17, window_minutes: 10080, resets_at: week }, null);
  writeReport(codexruntime.forAgent('codexkey'), at, { used_percent: 93, window_minutes: 10080, resets_at: week }, null);
  const all = await rows();
  const work = all.find((a) => a.provider === 'openai' && a.dir && fs.realpathSync(a.dir) === fs.realpathSync(CODEX_WORK));
  const sub = all.find((a) => a.provider === 'openai' && a.dir && fs.realpathSync(a.dir) === fs.realpathSync(CODEX));
  assert.ok(work && work.limits, 'the named sign-in\'s agent did not reach its row: ' + JSON.stringify(work && work.limits));
  assert.equal(work.limits.windows[0].usedPct, 17);
  assert.ok(!sub.limits || sub.limits.windows[0].usedPct !== 93, 'the key account\'s agent leaked into the default sign-in');
  assert.ok(!sub.limits || sub.limits.windows[0].usedPct !== 17, 'the named sign-in\'s agent leaked into the default sign-in');
  for (const n of ['codexwork', 'codexkey']) fs.rmSync(nodePath.join(codexruntime.forAgent(n), 'sessions'), { recursive: true, force: true });
});

test('#6176 a moved agent: a report from before its job last changed does not count', async () => {
  for (const d of [CODEX, CODEX_WORK]) fs.rmSync(nodePath.join(d, 'sessions'), { recursive: true, force: true });
  const week = Math.floor(Date.now() / 1000) + 3 * 86400;
  writeReport(codexruntime.forAgent('codexwork'), new Date(Date.now() - 3600e3).toISOString(), { used_percent: 66, window_minutes: 10080, resets_at: week }, null);
  const job = jobfix.jobPath('codexwork'), j0 = fs.statSync(job).mtime; fs.utimesSync(job, new Date(), new Date());   // the move rewrote the job just now
  const work = (await rows()).find((a) => a.provider === 'openai' && a.dir && fs.realpathSync(a.dir) === fs.realpathSync(CODEX_WORK));
  assert.equal(work.limits, null, 'the old account\'s report was shown on the new one');
  fs.utimesSync(job, j0, j0);   // later tests see the agent on its account for hours again
  fs.rmSync(nodePath.join(codexruntime.forAgent('codexwork'), 'sessions'), { recursive: true, force: true });
});

test('#6176 the account folder counts only since its sign-in: an older login\'s session there is not this account\'s', async () => {
  for (const d of [CODEX, CODEX_WORK]) fs.rmSync(nodePath.join(d, 'sessions'), { recursive: true, force: true });
  const week = Math.floor(Date.now() / 1000) + 3 * 86400;
  writeReport(CODEX, new Date(Date.now() - 3600e3).toISOString(), { used_percent: 81, window_minutes: 10080, resets_at: week }, null);
  await rows();   // the board has seen this login before
  const restore = relogin(CODEX);   // signed in again just now, under another login
  const sub = (await rows()).find((a) => a.provider === 'openai' && a.authMode === 'chatgpt' && fs.realpathSync(a.dir) === fs.realpathSync(CODEX));
  assert.equal(sub.limits, null, 'a report from before the sign-in was shown');
  restore();
  fs.rmSync(nodePath.join(CODEX, 'sessions'), { recursive: true, force: true });
});

test('#6176 a private home counts only since the account\'s sign-in: an agent\'s report from an older login is not this one\'s', async () => {
  for (const d of [CODEX, CODEX_WORK]) fs.rmSync(nodePath.join(d, 'sessions'), { recursive: true, force: true });
  const week = Math.floor(Date.now() / 1000) + 3 * 86400;
  { const t = new Date(Date.now() - 2 * 3600e3); fs.utimesSync(jobfix.jobPath('codexwork'), t, t); }   // on this account for two hours: only the sign-in can hide it
  writeReport(codexruntime.forAgent('codexwork'), new Date(Date.now() - 3600e3).toISOString(), { used_percent: 44, window_minutes: 10080, resets_at: week }, null);
  await rows();   // the board has seen this login before
  const restore = relogin(CODEX_WORK);   // signed in again just now, under another login
  const work = (await rows()).find((a) => a.provider === 'openai' && a.dir && fs.realpathSync(a.dir) === fs.realpathSync(CODEX_WORK));
  assert.equal(work.limits, null, 'an agent\'s report from before the sign-in was shown');
  restore();
  fs.rmSync(nodePath.join(codexruntime.forAgent('codexwork'), 'sessions'), { recursive: true, force: true });
});

test('#6176 a token refresh (same login, auth.json rewritten) keeps the meter', async () => {
  for (const x of [CODEX, CODEX_WORK]) fs.rmSync(nodePath.join(x, 'sessions'), { recursive: true, force: true });
  const week = Math.floor(Date.now() / 1000) + 3 * 86400;
  writeReport(CODEX, new Date(Date.now() - 3600e3).toISOString(), { used_percent: 52, window_minutes: 10080, resets_at: week }, null);
  const find = async () => (await rows()).find((a) => a.provider === 'openai' && a.authMode === 'chatgpt' && fs.realpathSync(a.dir) === fs.realpathSync(CODEX));
  assert.equal((await find()).limits.windows[0].usedPct, 52);
  const auth = nodePath.join(CODEX, 'auth.json'), t0 = fs.statSync(auth).mtime;
  fs.utimesSync(auth, new Date(), new Date());   // refreshed just now: same login
  const after = await find();
  assert.ok(after.limits && after.limits.windows[0].usedPct === 52, 'a refresh hid the meter: ' + JSON.stringify(after.limits));
  fs.utimesSync(auth, t0, t0);
  fs.rmSync(nodePath.join(CODEX, 'sessions'), { recursive: true, force: true });
});

test('#6176 a ChatGPT row whose last report is over carries limits: null', async () => {
  for (const d of [CODEX, CODEX_WORK]) fs.rmSync(nodePath.join(d, 'sessions'), { recursive: true, force: true });
  // Written AFTER the sign-in (three hours ago), so only the window being over can keep it off the row.
  writeReport(CODEX, new Date(Date.now() - 3600e3).toISOString(), { used_percent: 90, window_minutes: 300, resets_at: Math.floor(Date.now() / 1000) - 60 }, null);
  const sub = (await rows()).find((a) => a.provider === 'openai' && a.authMode === 'chatgpt' && fs.realpathSync(a.dir) === fs.realpathSync(CODEX));
  assert.equal(sub.limits, null);
});
