'use strict';

/*
 * kosmos#2413 -- /api/accounts overlays the last OBSERVED real Codex call onto the
 * OpenAI rows, so a working ChatGPT-subscription (codex chatgpt-mode) sign-in can go
 * positively green from real traffic, where checkLive can only ever leave it grey
 * ("not checked live"). The overlay is provider-qualified and ADDITIVE / POSITIVE-ONLY:
 *
 *   - a FRESH observed OpenAI `ok` greens the matching OpenAI row (badge 'working');
 *   - EVERY other case leaves the OpenAI row EXACTLY as it renders today -- an API-key
 *     row stays green off its real /v1/models check, a chatgpt row stays grey, a stale
 *     observation greys again. So the overlay can only ever ADD a green, never downgrade
 *     a genuinely-live API key nor turn a can't-check into a confident "not connected".
 *   - the join is per-provider AND per-account: an OpenAI `ok` never touches a Claude row
 *     (the cross-provider false-green this feature removes) and never another account.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'srv-openai-badge-2413-'));
const HOME = nodePath.join(SANDBOX, 'home');
const BIN = nodePath.join(SANDBOX, 'bin');
for (const d of [HOME, BIN, nodePath.join(SANDBOX, 'data'), nodePath.join(SANDBOX, 'workers'),
  nodePath.join(SANDBOX, 'launch'), nodePath.join(SANDBOX, 'projects')]) {
  fs.mkdirSync(d, { recursive: true });
}
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'projects');
// No AGENT_WORKFORCE_CODEX_HOME: the default codex home is HOME/.codex, so homeIsNamed()
// is false and both OpenAI accounts stay offerable (a named home collapses the list).
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;

const CLAUDE_BIN = nodePath.join(BIN, 'claude');
const TMUX_BIN = nodePath.join(BIN, 'tmux');
for (const b of [CLAUDE_BIN, TMUX_BIN]) fs.writeFileSync(b, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
process.env.AGENT_WORKFORCE_CLAUDE_BIN = CLAUDE_BIN;
process.env.AGENT_WORKFORCE_TMUX_BIN = TMUX_BIN;

const create = require('./engine/create');
const subscription = require('./engine/subscription');
const openai = require('./engine/openaiaccounts');
const observed = require('./engine/observed');
const codexsigninlive = require('./engine/codexsigninlive');

// --- Claude side: one default account + its agent (for the cross-provider isolation test).
fs.writeFileSync(nodePath.join(HOME, '.claude.json'),
  JSON.stringify({ oauthAccount: { emailAddress: 'boss@example.com' } }));
fs.mkdirSync(nodePath.join(HOME, '.claude', 'projects'), { recursive: true });

// --- OpenAI side: a DEFAULT chatgpt-subscription account (checkLive UNKNOWN -> grey),
//     and a labelled API-KEY account (checkLive CONNECTED via the faked /v1/models fetch).
const CODEX_DEFAULT = nodePath.join(HOME, '.codex');
fs.mkdirSync(CODEX_DEFAULT, { recursive: true });
const idPayload = Buffer.from(JSON.stringify({ email: 'sub@example.com' })).toString('base64url');
fs.writeFileSync(nodePath.join(CODEX_DEFAULT, 'auth.json'),
  JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: 'x.' + idPayload + '.y' } }));

const CODEX_KEY = nodePath.join(HOME, '.codex-key');
fs.mkdirSync(CODEX_KEY, { recursive: true });
fs.writeFileSync(nodePath.join(CODEX_KEY, 'auth.json'),
  JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-workingkeyworkingKEYX' }));

function born(name, configDir, runner) {
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(create.plistPath(name),
    create.plistFor(name, CLAUDE_BIN, TMUX_BIN, null, configDir, runner), 'utf8');
  return name;
}
born('bossagent', null, 'claude');
// A codex agent on the DEFAULT codex home -> configDir=null -> resolves to the default
// (chatgpt-subscription) OpenAI account. This is the Dave case: a working subscription agent.
born('codexsub', null, 'codex');

// checkLive: claude connected (a credential exists); OpenAI API-key /v1/models returns 200.
subscription.setRunner(async () => ({ stdout: JSON.stringify({ loggedIn: true, subscriptionType: 'max' }), err: null }));
openai.setFetcher(async () => ({ status: 200, body: { object: 'list', data: [{ id: 'gpt-4o' }] } }));

const { start, server } = require('./server');
let base = '';
test.before(async () => { await start(0); base = 'http://127.0.0.1:' + server.address().port; });
test.after(() => {
  try { server.close(); } catch { /* the port is going away anyway */ }
  subscription.setRunner(null);
  openai.setFetcher(null);
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});
test.beforeEach(() => {
  observed._clearForTest();
  // #1921: the render path reads codexsigninlive's CACHE (livenessCached), never a live handshake.
  // Reset it so the chatgpt row resolves UNKNOWN (cold miss -> grey) deterministically, independent
  // of anything a prior test or a warmer left in the cache. This is what un-flaked the CONTROL /
  // GREY-PRESERVED tests: before the render swap they awaited a real doctor handshake on a fake
  // token (dead), and the 20s timeout made them race.
  codexsigninlive.resetForTest();
});

async function rows() {
  const res = await fetch(base + '/api/accounts');
  assert.equal(res.status, 200);
  const body = await res.json();
  const openaiRows = body.accounts.filter((a) => a.provider === 'openai');
  return {
    all: body.accounts,
    claudeBoss: body.accounts.find((a) => a.provider === 'anthropic' && a.email === 'boss@example.com'),
    sub: openaiRows.find((a) => a.authMode === 'chatgpt'),   // the default subscription account
    key: openaiRows.find((a) => a.authMode === 'apikey'),    // the API-key account
  };
}

test('CONTROL: the default OpenAI account is a chatgpt subscription (state unknown), the API-key account is connected', async () => {
  const r = await rows();
  assert.ok(r.sub, 'the chatgpt-subscription OpenAI row is missing');
  assert.ok(r.key, 'the API-key OpenAI row is missing');
  assert.equal(r.sub.connection.state, 'unknown', 'a chatgpt sign-in cannot be live-checked, so its state is UNKNOWN');
  assert.equal(r.key.connection.state, 'connected', 'the API-key account passed the /v1/models check');
  // No observation seeded yet: neither OpenAI row carries a server badge.
  assert.equal(r.sub.connection.badge, undefined, 'the subscription row must NOT carry a badge before any traffic is observed');
  assert.equal(r.key.connection.badge, undefined, 'the API-key row must NOT be overlaid with a badge (it renders green off its live check)');
});

test('THE FIX: a fresh observed OpenAI ok greens the working subscription row (badge working, with an age)', async () => {
  observed.saw(observed.PROVIDER.OPENAI, 'codexsub', observed.OUTCOME.OK, Date.now());
  const r = await rows();
  assert.equal(r.sub.connection.badge, 'working',
    'a real successful Codex call on the subscription account did not go green: ' + JSON.stringify(r.sub.connection));
  assert.equal(typeof r.sub.connection.observedAgeMs, 'number');
  assert.ok(r.sub.connection.observedAgeMs >= 0);
  // The API-key row, unobserved, is NOT dragged along -- the join is per-account, and it
  // keeps its own live-check render (no badge) rather than being downgraded.
  assert.equal(r.key.connection.badge, undefined, 'an ok on the subscription account tainted the API-key row');
});

test('NO REGRESSION: a fresh observed ok does not downgrade a live API-key account', async () => {
  // A codex agent on the API-key account, observed working, should ADD green -- never turn
  // the API-key row's genuine `connected` into a muted signed_in_unverified.
  born('codexkey', CODEX_KEY, 'codex');
  observed.saw(observed.PROVIDER.OPENAI, 'codexkey', observed.OUTCOME.OK, Date.now());
  const r = await rows();
  assert.equal(r.key.connection.badge, 'working', 'a real successful call did not upgrade the API-key row to observed-working');
  // And with NO observation at all it must stay green off its live check (proved by the CONTROL:
  // no badge -> the web renders state==='connected' as "Signed in"). The overlay never removes that.
  assert.equal(r.key.connection.state, 'connected', 'the underlying live-check state must be preserved untouched');
});

test('ISOLATION: an OpenAI ok never touches the Claude row, and an ANTHROPIC ok never greens the OpenAI row', async () => {
  // An OpenAI observation for the codex agent must not reach the Claude overlay (which joins
  // via the CLAUDE account list) -- the cross-provider false-green this feature removes.
  observed.saw(observed.PROVIDER.OPENAI, 'codexsub', observed.OUTCOME.OK, Date.now());
  let r = await rows();
  assert.equal(r.claudeBoss.connection.badge, 'signed_in_unverified',
    'an OpenAI ok leaked onto the Claude account badge: ' + JSON.stringify(r.claudeBoss.connection));

  // And the reverse: an ANTHROPIC observation under the codex agent's name must NOT green the
  // OpenAI row (the OpenAI overlay reads only PROVIDER.OPENAI observations).
  observed._clearForTest();
  observed.saw(observed.PROVIDER.ANTHROPIC, 'codexsub', observed.OUTCOME.OK, Date.now());
  r = await rows();
  assert.equal(r.sub.connection.badge, undefined,
    'an ANTHROPIC ok greened the OpenAI subscription row -- the provider filter on the OpenAI join is not holding');
});

test('GREY PRESERVED: a STALE observed ok leaves the subscription row exactly as it renders today (no badge)', async () => {
  const prev = process.env.AGENT_WORKFORCE_OBSERVED_FRESH_MS;
  process.env.AGENT_WORKFORCE_OBSERVED_FRESH_MS = '1'; // 1ms window: any observation is instantly stale
  try {
    observed.saw(observed.PROVIDER.OPENAI, 'codexsub', observed.OUTCOME.OK, Date.now() - 1000);
    const r = await rows();
    assert.equal(r.sub.connection.badge, undefined,
      'a stale ok stamped a confident badge instead of falling back to the untouched grey chatgpt render: ' + JSON.stringify(r.sub.connection));
    assert.equal(r.sub.connection.state, 'unknown', 'the underlying chatgpt UNKNOWN state must be preserved');
  } finally {
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_OBSERVED_FRESH_MS;
    else process.env.AGENT_WORKFORCE_OBSERVED_FRESH_MS = prev;
  }
});
