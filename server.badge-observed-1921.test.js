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
 * still says connected (an external tester's screen: two same-email accounts both "Signed in" while
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

test('THE EXPIRED-401 CASE: a fresh observed 401 shows not-connected EVEN THOUGH checkLive says connected', async () => {
  observed.saw(observed.PROVIDER.ANTHROPIC, 'ariaagent', observed.OUTCOME.REJECTED, Date.now());
  const m = await badges();
  assert.equal(m.get('aria@example.com').badge, 'rejected',
    'a real 401 on aria did not override the stored-login green: ' + JSON.stringify(m.get('aria@example.com')));
  assert.equal(typeof m.get('aria@example.com').observedAgeMs, 'number');
  // The other accounts, with no observation, stay unverified -- not dragged red, not green.
  assert.equal(m.get('boss@example.com').badge, 'signed_in_unverified');
  assert.equal(m.get('cleo@example.com').badge, 'signed_in_unverified');
});

test('GREEN IS EARNED: a fresh observed ok on the DEFAULT account shows working, and joins the default row', async () => {
  observed.saw(observed.PROVIDER.ANTHROPIC, 'bossagent', observed.OUTCOME.OK, Date.now());
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
    observed.saw(observed.PROVIDER.ANTHROPIC, 'ariaagent', observed.OUTCOME.REJECTED, Date.now() - 1000);
    const m = await badges();
    assert.equal(m.get('aria@example.com').badge, 'signed_in_unverified',
      'a stale 401 kept asserting not-connected instead of falling back: ' + JSON.stringify(m.get('aria@example.com')));
  } finally {
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_OBSERVED_FRESH_MS;
    else process.env.AGENT_WORKFORCE_OBSERVED_FRESH_MS = prev;
  }
});

/* #3136: on-demand "Check now". The passive badge only greens from a witnessed
   streaming turn, so cleo -- signed in but with NO agent -- can never green and
   sits at signed_in_unverified forever (Josh's exact report on 0.6.68). A
   dir-keyed check-now observation, and the POST route that records one, fix that.
   Same harness, same badges() reader, same CONNECTED-everywhere checkLive. */

async function checkNow(dir) {
  const res = await fetch(base + '/api/accounts/claude/check', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dir }),
  });
  return { status: res.status, body: await res.json() };
}

test('#3136 JOIN: a dir-keyed check-now ok greens the AGENT-LESS account (cleo) the agent path never could', async () => {
  // Control (already proven above): with nothing observed, cleo is signed_in_unverified.
  // The agent store CANNOT reach cleo (no agent runs on it), so this green is only
  // possible via the dir-keyed store -- exactly what unblocks Josh's agent-less accounts.
  observed.sawDir(observed.PROVIDER.ANTHROPIC, CLEO_DIR, observed.OUTCOME.OK, Date.now());
  const m = await badges();
  assert.equal(m.get('cleo@example.com').badge, 'working',
    'a check-now ok did not green the agent-less account: ' + JSON.stringify(m.get('cleo@example.com')));
  // Per-account: boss and aria, with no observation, stay unverified (not a blanket flip).
  assert.equal(m.get('boss@example.com').badge, 'signed_in_unverified');
  assert.equal(m.get('aria@example.com').badge, 'signed_in_unverified');
});

test('#3136 ROUTE: POST check -> a real CONNECTED probe records ok and greens the account', async () => {
  create.setClaudeProbe(async () => ({ exitCode: 0, out: 'ok' })); // a clean "reply ok" = CONNECTED
  try {
    const r = await checkNow(CLEO_DIR);
    assert.equal(r.status, 200);
    assert.equal(r.body.state, 'connected');
    const m = await badges();
    assert.equal(m.get('cleo@example.com').badge, 'working',
      'a CONNECTED check-now did not green the account: ' + JSON.stringify(m.get('cleo@example.com')));
  } finally { create.setClaudeProbe(null); }
});

test('#3136 ROUTE: a positively-dead sign-in records 401 and reddens (honest not-connected)', async () => {
  create.setClaudeProbe(async () => ({ exitCode: 1, out: 'API Error: 401 OAuth access token has expired.' }));
  try {
    const r = await checkNow(CLEO_DIR);
    assert.equal(r.status, 200);
    assert.equal(r.body.state, 'none');
    const m = await badges();
    assert.equal(m.get('cleo@example.com').badge, 'rejected',
      'a positively-dead check did not redden the account: ' + JSON.stringify(m.get('cleo@example.com')));
  } finally { create.setClaudeProbe(null); }
});

test('#3136 ROUTE: UNKNOWN (capacity) records NOTHING and leaves the prior badge -- never a false not-connected', async () => {
  // A live-but-capped account is NOT dead (#1315/#1916). Seed a prior green, then a
  // capped check must leave it green rather than clobbering it to gray/red.
  observed.sawDir(observed.PROVIDER.ANTHROPIC, CLEO_DIR, observed.OUTCOME.OK, Date.now());
  create.setClaudeProbe(async () => ({ exitCode: 1, out: 'usage limit reached' })); // capacity -> UNKNOWN
  try {
    const r = await checkNow(CLEO_DIR);
    assert.equal(r.status, 200);
    assert.equal(r.body.state, 'unknown');
    const m = await badges();
    assert.equal(m.get('cleo@example.com').badge, 'working',
      'an inconclusive (capped) check clobbered a prior green: ' + JSON.stringify(m.get('cleo@example.com')));
  } finally { create.setClaudeProbe(null); }
});

test('#3136 ROUTE: an unknown account dir is a 404, and no probe is fired', async () => {
  let probed = false;
  create.setClaudeProbe(async () => { probed = true; return { exitCode: 0, out: 'ok' }; });
  try {
    const r = await checkNow(nodePath.join(HOME, '.claude-does-not-exist'));
    assert.equal(r.status, 404);
    assert.equal(probed, false, 'a 404 account should be rejected before the probe runs');
  } finally { create.setClaudeProbe(null); }
});

test('#3136 ROUTE: the DEFAULT account probes with its RESOLVED dir (not null), so it does not lean on the launchd-broken ambient default, and greens', async () => {
  // #3136 FIX (was: probe the default with CLAUDE_CONFIG_DIR unset, "claude's true default").
  // That deleted-env path relied on claude -p's OWN ambient default resolution, which fails
  // in the board's launchd process (wrong/missing HOME -> config-not-found -> a fast non-zero
  // exit -> UNKNOWN -> the badge never greens). Reproduced server-side on 0.6.70: a labelled
  // account greened, the default stayed neutral, the default probe failed in ~4-5s (not the
  // 15s timeout). The fix passes the default's RESOLVED dir (accounts.js's env-independent
  // <homeDir>/.claude) explicitly, so the probe does not depend on the launchd env. The
  // observation is still keyed by the row's dir, so boss (the default) greens. boss@ is the
  // default in this fixture (born null). NOTE: a fake probe cannot reproduce the launchd-env
  // failure (it ignores configDir), so this asserts the CONTRACT (default -> its dir); the
  // real green is verified against the served board's live Check now.
  const def = accounts.list().find((a) => a.isDefault);
  assert.ok(def && def.dir, 'the fixture has a default account with a dir: ' + JSON.stringify(accounts.list().map((a) => ({ e: a.email, d: a.isDefault }))));
  let gotConfigDir = 'UNSET_SENTINEL';
  create.setClaudeProbe(async (configDir) => { gotConfigDir = configDir; return { exitCode: 0, out: 'ok' }; });
  try {
    const r = await checkNow(def.dir);
    assert.equal(r.status, 200);
    assert.equal(r.body.state, 'connected');
    assert.equal(gotConfigDir, def.dir, 'the default account must probe with its RESOLVED dir, not null (#3136 launchd-env fix), got: ' + JSON.stringify(gotConfigDir));
    const m = await badges();
    assert.equal(m.get('boss@example.com').badge, 'working',
      'a CONNECTED check-now on the default account did not green it: ' + JSON.stringify(m.get('boss@example.com')));
  } finally { create.setClaudeProbe(null); }
});

test('#3136 ROUTE: a LABELLED account probes with its own dir (not null)', async () => {
  // The mirror of the above: a non-default account must pass its dir, so the probe runs
  // against THAT account's config rather than the machine default. Control for the null-branch.
  let gotConfigDir = 'UNSET_SENTINEL';
  create.setClaudeProbe(async (configDir) => { gotConfigDir = configDir; return { exitCode: 0, out: 'ok' }; });
  try {
    const r = await checkNow(CLEO_DIR);
    assert.equal(r.status, 200);
    assert.equal(gotConfigDir, CLEO_DIR, 'a labelled account must probe with its own dir, got: ' + JSON.stringify(gotConfigDir));
  } finally { create.setClaudeProbe(null); }
});

/* #3136: the fresher-of-two MERGE (server.js Claude arm). When one account has BOTH a
   passively-witnessed agent observation AND a user-initiated check-now observation, the
   badge must reflect the FRESHER one. aria has an agent (ariaagent -> ARIA_DIR) AND we can
   seed a dir observation on ARIA_DIR, so it is the one account that can hold both. These two
   are each other's control: reverse the comparison and exactly one of them flips to the
   wrong badge, so they pin the direction, not just the happy path. */

test('#3136 MERGE: a NEWER agent 401 wins over an OLDER check-now ok (badge rejected)', async () => {
  const now = Date.now();
  observed.sawDir(observed.PROVIDER.ANTHROPIC, ARIA_DIR, observed.OUTCOME.OK, now - 2000); // older check-now ok
  observed.saw(observed.PROVIDER.ANTHROPIC, 'ariaagent', observed.OUTCOME.REJECTED, now);   // newer agent 401
  const m = await badges();
  assert.equal(m.get('aria@example.com').badge, 'rejected',
    'the newer agent 401 did not win the merge over the older check-now ok: ' + JSON.stringify(m.get('aria@example.com')));
});

test('#3136 MERGE: a NEWER check-now ok wins over an OLDER agent 401 (badge working)', async () => {
  const now = Date.now();
  observed.saw(observed.PROVIDER.ANTHROPIC, 'ariaagent', observed.OUTCOME.REJECTED, now - 2000); // older agent 401
  observed.sawDir(observed.PROVIDER.ANTHROPIC, ARIA_DIR, observed.OUTCOME.OK, now);               // newer check-now ok
  const m = await badges();
  assert.equal(m.get('aria@example.com').badge, 'working',
    'the newer check-now ok did not win the merge over the older agent 401: ' + JSON.stringify(m.get('aria@example.com')));
});
