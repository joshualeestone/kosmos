'use strict';

/*
 * kosmos#3296 observability follow-on -- /api/accounts overlays the last OBSERVED real
 * Gemini turn onto the GOOGLE rows, the exact sibling of the #2413 OpenAI overlay. It is
 * provider-qualified and ADDITIVE / POSITIVE-ONLY:
 *
 *   - a FRESH observed GOOGLE `ok` greens the matching gemini row (badge 'working');
 *   - EVERY other case leaves the gemini row EXACTLY as it renders today off its live key
 *     check -- a stale observation greys again, an unobserved row keeps its own render. So
 *     the overlay can only ADD a green, never downgrade a genuinely-live key.
 *   - the join is per-provider AND per-account: a GOOGLE `ok` never touches a Claude/OpenAI
 *     row and never another account.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'srv-gemini-badge-3296-'));
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
const gemini = require('./engine/geminiaccounts');
const grok = require('./engine/grokaccounts');
const observed = require('./engine/observed');

// --- Claude side: one default account (for the cross-provider isolation test).
fs.writeFileSync(nodePath.join(HOME, '.claude.json'),
  JSON.stringify({ oauthAccount: { emailAddress: 'boss@example.com' } }));
fs.mkdirSync(nodePath.join(HOME, '.claude', 'projects'), { recursive: true });

// --- Gemini side: a named API-key account (checkLive CONNECTED via the faked models fetch),
//     and a gemini agent whose configDir IS that account dir (the accountForAgent join).
const GEMINI_DIR = gemini.dirForLabel('main').dir;   // HOME/.gemini-main
fs.mkdirSync(GEMINI_DIR, { recursive: true });
gemini.storeKey(GEMINI_DIR, 'AIza-gemini-key-1234');

function born(name, configDir, runner) {
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(create.plistPath(name),
    create.plistFor(name, CLAUDE_BIN, TMUX_BIN, null, configDir, runner), 'utf8');
  return name;
}
born('bossagent', null, 'claude');
born('geminimain', GEMINI_DIR, 'gemini');   // per-account gemini agent -> joins the .gemini-main row

// checkLive: claude connected; gemini models fetch 200 (connected); openai/grok fetchers benign.
subscription.setRunner(async () => ({ stdout: JSON.stringify({ loggedIn: true, subscriptionType: 'max' }), err: null }));
openai.setFetcher(async () => ({ status: 200, body: { object: 'list', data: [] } }));
gemini.setFetcher(async () => ({ status: 200, body: {} }));
grok.setFetcher(async () => ({ status: 200, body: {} }));

const { start, server } = require('./server');
let base = '';
test.before(async () => { await start(0); base = 'http://127.0.0.1:' + server.address().port; });
test.after(() => {
  try { server.close(); } catch { /* the port is going away anyway */ }
  subscription.setRunner(null); openai.setFetcher(null); gemini.setFetcher(null); grok.setFetcher(null);
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});
test.beforeEach(() => observed._clearForTest());

async function rows() {
  const res = await fetch(base + '/api/accounts');
  assert.equal(res.status, 200);
  const body = await res.json();
  return {
    all: body.accounts,
    claudeBoss: body.accounts.find((a) => a.provider === 'anthropic' && a.email === 'boss@example.com'),
    gem: body.accounts.find((a) => a.provider === 'google' && a.label === 'main'),
  };
}

test('CONTROL: the gemini account lists connected off its live key check, with no badge before any traffic', async () => {
  const r = await rows();
  assert.ok(r.gem, 'the gemini account row is missing from /api/accounts');
  assert.equal(r.gem.connection.state, 'connected', 'the gemini API-key account did not pass its live models check');
  assert.equal(r.gem.connection.badge, undefined, 'the gemini row must NOT carry a badge before any traffic is observed');
});

test('THE FIX: a fresh observed GOOGLE ok greens the working gemini row (badge working, with an age)', async () => {
  observed.saw(observed.PROVIDER.GOOGLE, 'geminimain', observed.OUTCOME.OK, Date.now());
  const r = await rows();
  assert.equal(r.gem.connection.badge, 'working',
    'a real successful Gemini turn on the account did not go green: ' + JSON.stringify(r.gem.connection));
  assert.equal(typeof r.gem.connection.observedAgeMs, 'number');
  assert.ok(r.gem.connection.observedAgeMs >= 0);
});

test('ISOLATION: a GOOGLE ok never touches the Claude row, and an ANTHROPIC ok never greens the gemini row', async () => {
  observed.saw(observed.PROVIDER.GOOGLE, 'geminimain', observed.OUTCOME.OK, Date.now());
  let r = await rows();
  assert.equal(r.claudeBoss.connection.badge, 'signed_in_unverified',
    'a GOOGLE ok leaked onto the Claude account badge: ' + JSON.stringify(r.claudeBoss.connection));

  // Reverse: an ANTHROPIC observation under the gemini agent's name must NOT green the gemini row.
  observed._clearForTest();
  observed.saw(observed.PROVIDER.ANTHROPIC, 'geminimain', observed.OUTCOME.OK, Date.now());
  r = await rows();
  assert.equal(r.gem.connection.badge, undefined,
    'an ANTHROPIC ok greened the gemini row -- the provider filter on the GOOGLE join is not holding');
});

test('GREY PRESERVED: a STALE observed GOOGLE ok leaves the gemini row exactly as it renders today (no badge, still connected)', async () => {
  const prev = process.env.AGENT_WORKFORCE_OBSERVED_FRESH_MS;
  process.env.AGENT_WORKFORCE_OBSERVED_FRESH_MS = '1'; // 1ms window: any observation is instantly stale
  try {
    observed.saw(observed.PROVIDER.GOOGLE, 'geminimain', observed.OUTCOME.OK, Date.now() - 1000);
    const r = await rows();
    assert.equal(r.gem.connection.badge, undefined,
      'a stale ok stamped a confident badge instead of falling back to the untouched live-check render: ' + JSON.stringify(r.gem.connection));
    assert.equal(r.gem.connection.state, 'connected', 'the underlying live-check state must be preserved untouched');
  } finally {
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_OBSERVED_FRESH_MS;
    else process.env.AGENT_WORKFORCE_OBSERVED_FRESH_MS = prev;
  }
});

test('SCOPE: a DEFAULT-account gemini agent (configDir null) badges nothing and does not leak onto a named row', async () => {
  // Documented boundary (see the server overlay comment): geminiAccounts.listLive() emits only
  // NAMED accounts in this slice, so a default-account gemini agent has no row to badge. Its
  // recorded observation must NOT green a NAMED row -- accountForAgent(name, geminiRows) returns
  // null for a null-configDir agent, so it joins no gemini row -- and must not crash the route.
  born('geminidefault', null, 'gemini');
  observed.saw(observed.PROVIDER.GOOGLE, 'geminidefault', observed.OUTCOME.OK, Date.now());
  const r = await rows();
  assert.equal(r.gem.connection.badge, undefined,
    'a default-account gemini agent observation leaked onto the named account row: ' + JSON.stringify(r.gem.connection));
  // No default gemini row is emitted, so the accounts list carries no google row but the named one.
  const googleRows = r.all.filter((a) => a.provider === 'google');
  assert.equal(googleRows.length, 1, 'exactly the one NAMED gemini row is listed; no default row appears in this slice');
});
