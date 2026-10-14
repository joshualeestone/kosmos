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
fs.writeFileSync(nodePath.join(CODEX, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: 'x.' + idPayload + '.y' } }));
const CODEX_KEY = nodePath.join(HOME, '.codex-key');
fs.mkdirSync(CODEX_KEY, { recursive: true });
fs.writeFileSync(nodePath.join(CODEX_KEY, 'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-workingkeyworkingKEYX' }));

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

test('#6176 a ChatGPT row whose last report is over carries limits: null', async () => {
  writeReport(CODEX, new Date(Date.now() - 6 * 3600e3).toISOString(), { used_percent: 90, window_minutes: 300, resets_at: Math.floor(Date.now() / 1000) - 60 }, null);
  const sub = (await rows()).find((a) => a.provider === 'openai' && a.authMode === 'chatgpt');
  assert.equal(sub.limits, null);
});
