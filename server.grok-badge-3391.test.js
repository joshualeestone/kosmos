'use strict';

/*
 * kosmos#3391 observability follow-on -- /api/accounts overlays the last OBSERVED real Grok
 * turn onto the XAI rows, the identical sibling of the #2413 OpenAI / #3296 Gemini overlays.
 * Provider-qualified, ADDITIVE / POSITIVE-ONLY:
 *   - a FRESH observed XAI `ok` greens the matching grok row (badge 'working');
 *   - every other case leaves the grok row as it renders off its live key check;
 *   - the join is per-provider AND per-account: an XAI `ok` never touches a claude/openai/google
 *     row and never another account.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'srv-grok-badge-3391-'));
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

// --- Grok side: a named API-key account (checkLive CONNECTED via the faked models fetch),
//     and a grok agent whose configDir IS that account dir (the accountForAgent join).
const GROK_DIR = grok.dirForLabel('main').dir;   // HOME/.grok-main
fs.mkdirSync(GROK_DIR, { recursive: true });
grok.storeKey(GROK_DIR, 'xai-grok-key-1234');

function born(name, configDir, runner) {
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(create.plistPath(name),
    create.plistFor(name, CLAUDE_BIN, TMUX_BIN, null, configDir, runner), 'utf8');
  return name;
}
born('bossagent', null, 'claude');
born('grokmain', GROK_DIR, 'grok');   // per-account grok agent -> joins the .grok-main row

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
    gk: body.accounts.find((a) => a.provider === 'xai' && a.label === 'main'),
  };
}

test('CONTROL: the grok account lists connected off its live key check, with no badge before any traffic', async () => {
  const r = await rows();
  assert.ok(r.gk, 'the grok account row is missing from /api/accounts');
  assert.equal(r.gk.connection.state, 'connected', 'the grok API-key account did not pass its live models check');
  assert.equal(r.gk.connection.badge, undefined, 'the grok row must NOT carry a badge before any traffic is observed');
});

test('THE FIX: a fresh observed XAI ok greens the working grok row (badge working, with an age)', async () => {
  observed.saw(observed.PROVIDER.XAI, 'grokmain', observed.OUTCOME.OK, Date.now());
  const r = await rows();
  assert.equal(r.gk.connection.badge, 'working',
    'a real successful Grok turn on the account did not go green: ' + JSON.stringify(r.gk.connection));
  assert.equal(typeof r.gk.connection.observedAgeMs, 'number');
  assert.ok(r.gk.connection.observedAgeMs >= 0);
});

test('ISOLATION: an XAI ok never touches the Claude row, and an ANTHROPIC ok never greens the grok row', async () => {
  observed.saw(observed.PROVIDER.XAI, 'grokmain', observed.OUTCOME.OK, Date.now());
  let r = await rows();
  assert.equal(r.claudeBoss.connection.badge, 'signed_in_unverified',
    'an XAI ok leaked onto the Claude account badge: ' + JSON.stringify(r.claudeBoss.connection));

  observed._clearForTest();
  observed.saw(observed.PROVIDER.ANTHROPIC, 'grokmain', observed.OUTCOME.OK, Date.now());
  r = await rows();
  assert.equal(r.gk.connection.badge, undefined,
    'an ANTHROPIC ok greened the grok row -- the provider filter on the XAI join is not holding');
});

test('GREY PRESERVED: a STALE observed XAI ok leaves the grok row exactly as it renders today (no badge, still connected)', async () => {
  const prev = process.env.AGENT_WORKFORCE_OBSERVED_FRESH_MS;
  process.env.AGENT_WORKFORCE_OBSERVED_FRESH_MS = '1';
  try {
    observed.saw(observed.PROVIDER.XAI, 'grokmain', observed.OUTCOME.OK, Date.now() - 1000);
    const r = await rows();
    assert.equal(r.gk.connection.badge, undefined,
      'a stale ok stamped a confident badge instead of the untouched live-check render: ' + JSON.stringify(r.gk.connection));
    assert.equal(r.gk.connection.state, 'connected', 'the underlying live-check state must be preserved untouched');
  } finally {
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_OBSERVED_FRESH_MS;
    else process.env.AGENT_WORKFORCE_OBSERVED_FRESH_MS = prev;
  }
});

test('SCOPE: a DEFAULT-account grok agent (configDir null) badges nothing and does not leak onto a named row', async () => {
  born('grokdefault', null, 'grok');
  observed.saw(observed.PROVIDER.XAI, 'grokdefault', observed.OUTCOME.OK, Date.now());
  const r = await rows();
  assert.equal(r.gk.connection.badge, undefined,
    'a default-account grok agent observation leaked onto the named account row: ' + JSON.stringify(r.gk.connection));
  const xaiRows = r.all.filter((a) => a.provider === 'xai');
  assert.equal(xaiRows.length, 1, 'exactly the one NAMED grok row is listed; no default row appears in this slice');
});
