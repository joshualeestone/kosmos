'use strict';

/*
 * kosmos#1921 -- the Settings account badge renders VERIFIED liveness from the last
 * OBSERVED real call, not from `claude auth status` (which returns loggedIn:true for
 * a rejected token, #874). This drives the real /api/accounts route.
 *
 * The fixture holds THREE accounts, and checkLive is faked to say CONNECTED for ALL
 * of them -- i.e. a credential EXISTS everywhere. That is exactly the state that used
 * to paint every account green. The badge must now refuse that green until a real
 * call is observed, and must show a fresh 401 as not-connected even while checkLive
 * still says connected (Ben's screen: two same-email accounts both "Signed in" while
 * one was 401ing).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'srv-badge-observed-1921-'));
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
const accounts = require('./engine/accounts');
const subscription = require('./engine/subscription');
const observed = require('./engine/observed');

// Three accounts, each with a credential present on disk. The DEFAULT record sits
// beside ~/.claude (at ~/.claude.json); a labelled dir keeps its own inside it.
fs.writeFileSync(nodePath.join(HOME, '.claude.json'),
  JSON.stringify({ oauthAccount: { emailAddress: 'boss@example.com' } }));
fs.mkdirSync(nodePath.join(HOME, '.claude', 'projects'), { recursive: true });

const ARIA_DIR = nodePath.join(HOME, '.claude-aria');
fs.mkdirSync(nodePath.join(ARIA_DIR, 'projects'), { recursive: true });
fs.writeFileSync(nodePath.join(ARIA_DIR, '.claude.json'),
  JSON.stringify({ oauthAccount: { emailAddress: 'aria@example.com' } }));

const CLEO_DIR = nodePath.join(HOME, '.claude-cleo');
fs.mkdirSync(nodePath.join(CLEO_DIR, 'projects'), { recursive: true });
fs.writeFileSync(nodePath.join(CLEO_DIR, '.claude.json'),
  JSON.stringify({ oauthAccount: { emailAddress: 'cleo@example.com' } }));

/* Two agents wired to accounts via their launch record (create.readJob), which is
   what accountForAgent joins observations to. `bossagent` runs on the default (no
   configDir), `ariaagent` on the suffixed aria dir. `cleo` has NO agent, so it can
   never be observed -- the never-observed row that must NOT read green. */
function born(name, configDir) {
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(create.plistPath(name),
    create.plistFor(name, CLAUDE_BIN, TMUX_BIN, null, configDir, 'claude'), 'utf8');
  return name;
}
born('bossagent', null);
born('ariaagent', ARIA_DIR);

// checkLive says CONNECTED for EVERY dir -- a credential exists everywhere. This is
// the state that used to paint all three green.
subscription.setRunner(async () => ({ stdout: JSON.stringify({ loggedIn: true, subscriptionType: 'max' }), err: null }));

const { start, server } = require('./server');
let base = '';
test.before(async () => { await start(0); base = 'http://127.0.0.1:' + server.address().port; });
test.after(() => {
  try { server.close(); } catch { /* the port is going away anyway */ }
  subscription.setRunner(null);
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});
test.beforeEach(() => observed._clearForTest());

async function badges() {
  const res = await fetch(base + '/api/accounts');
  assert.equal(res.status, 200);
  const body = await res.json();
  const map = new Map();
  for (const a of body.accounts) if (a.provider === 'anthropic') map.set(a.email, a.connection);
  return map;
}

test('CONTROL: the fixture holds three Claude accounts, all with checkLive CONNECTED', async () => {
  const dirs = accounts.list();
  assert.ok(dirs.length >= 3, 'expected the default + aria + cleo: ' + JSON.stringify(dirs.map((d) => d.dir)));
  const m = await badges();
  for (const email of ['boss@example.com', 'aria@example.com', 'cleo@example.com']) {
    assert.ok(m.has(email), 'account missing from /api/accounts: ' + email + ' -> ' + JSON.stringify([...m.keys()]));
    assert.equal(m.get(email).state, 'connected', 'checkLive should say connected for ' + email);
  }
});

test('THE FIX: a credential that only EXISTS (checkLive connected, nothing observed) is NOT green', async () => {
  // No observations seeded. Every account has checkLive connected. Before #1921 this
  // painted all three "Signed in" green; now none of them may.
  const m = await badges();
  for (const email of ['boss@example.com', 'aria@example.com', 'cleo@example.com']) {
    assert.equal(m.get(email).badge, 'signed_in_unverified',
      email + ' showed a confident badge on a credential that was never observed working: ' + JSON.stringify(m.get(email)));
  }
});

test('THE BEN CASE: a fresh observed 401 shows not-connected EVEN THOUGH checkLive says connected', async () => {
  observed.saw('ariaagent', observed.OUTCOME.REJECTED, Date.now());
  const m = await badges();
  assert.equal(m.get('aria@example.com').badge, 'rejected',
    'a real 401 on aria did not override the stored-login green: ' + JSON.stringify(m.get('aria@example.com')));
  assert.equal(typeof m.get('aria@example.com').observedAgeMs, 'number');
  // The other accounts, with no observation, stay unverified -- not dragged red, not green.
  assert.equal(m.get('boss@example.com').badge, 'signed_in_unverified');
  assert.equal(m.get('cleo@example.com').badge, 'signed_in_unverified');
});

test('GREEN IS EARNED: a fresh observed ok on the DEFAULT account shows working, and joins the default row', async () => {
  observed.saw('bossagent', observed.OUTCOME.OK, Date.now());
  const m = await badges();
  const boss = m.get('boss@example.com');
  assert.equal(boss.badge, 'working', 'an observed successful call on the default account did not go green: ' + JSON.stringify(boss));
  assert.equal(typeof boss.observedAgeMs, 'number');
  assert.ok(boss.observedAgeMs >= 0);
  // aria and cleo, unobserved, remain unverified -- proving the join is per-account,
  // not a blanket flip.
  assert.equal(m.get('aria@example.com').badge, 'signed_in_unverified');
  assert.equal(m.get('cleo@example.com').badge, 'signed_in_unverified');
});

test('a STALE observation does not linger as a confident badge (falls back to checkLive)', async () => {
  const prev = process.env.AGENT_WORKFORCE_OBSERVED_FRESH_MS;
  process.env.AGENT_WORKFORCE_OBSERVED_FRESH_MS = '1'; // 1ms window: any observation is instantly stale
  try {
    observed.saw('ariaagent', observed.OUTCOME.REJECTED, Date.now() - 1000);
    const m = await badges();
    assert.equal(m.get('aria@example.com').badge, 'signed_in_unverified',
      'a stale 401 kept asserting not-connected instead of falling back: ' + JSON.stringify(m.get('aria@example.com')));
  } finally {
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_OBSERVED_FRESH_MS;
    else process.env.AGENT_WORKFORCE_OBSERVED_FRESH_MS = prev;
  }
});
