'use strict';
/* #3997: an idle, signed-in Claude account shows its login as good ("Signed in · login good until <date>"), read
   from its own login date. Ruling C (09-28) drew it neutral; ruling A (Josh, 10-02) draws it green.
   The login-date reader is injected (claudeloginlive.setReaderForTests): no keychain is read. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'srv-claudelogin-3997-'));
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

const claudeloginlive = require('./engine/claudeloginlive');
const DAY = 86400000;
const FUTURE = Date.now() + 20 * DAY;
const PAST = Date.now() - DAY;
const asked = [];
// The default account (ccd unset) and aria have a login ahead; cleo's has run out.
claudeloginlive.setReaderForTests((ccd) => { asked.push(ccd); return ccd === CLEO_DIR ? PAST : FUTURE; });

const { start, server } = require('./server');
let base = '';
test.before(async () => { await start(0); base = 'http://127.0.0.1:' + server.address().port; });
test.after(() => {
  try { server.close(); } catch { /* the port is going away anyway */ }
  subscription.setRunner(null);
  claudeloginlive.setReaderForTests(null);
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});
test.beforeEach(() => { observed._clearForTest(); claudeloginlive._clearForTest(); asked.length = 0; });

async function rows() {
  const res = await fetch(base + '/api/accounts');
  assert.equal(res.status, 200);
  const map = new Map();
  for (const a of (await res.json()).accounts) if (a.provider === 'anthropic') map.set(a.email, a.connection);
  return map;
}

test('#3997 ruling A: an idle sign-in with a login ahead carries its date and is GREEN, from its login', async () => {
  const m = await rows();
  for (const email of ['boss@example.com', 'aria@example.com']) {
    assert.equal(m.get(email).badge, 'working', email + ' is not green: ' + JSON.stringify(m.get(email)));
    assert.equal(m.get(email).observedFrom, 'login', email + ' was not marked green from its login');
    assert.equal(m.get(email).loginValidUntil, FUTURE, email + ' did not carry its login date');
  }
  // CONTROL: a login that has run out stays unverified (not green, no date), the honest state.
  assert.equal(m.get('cleo@example.com').badge, 'signed_in_unverified');
  assert.notEqual(m.get('cleo@example.com').observedFrom, 'login');
  assert.equal(m.get('cleo@example.com').loginValidUntil, undefined, 'a login that has run out was shown as good');
});

test('#3997: each row reads the entry claude auth status reads (default with CLAUDE_CONFIG_DIR unset, others with their folder)', async () => {
  await rows();
  assert.ok(asked.includes(undefined), 'the default account was not read with CLAUDE_CONFIG_DIR unset: ' + JSON.stringify(asked));
  assert.ok(asked.includes(ARIA_DIR), 'aria was not read with its own folder: ' + JSON.stringify(asked));
  assert.ok(!asked.includes(nodePath.join(HOME, '.claude')), 'the default account was read with its path set (the #2129 decoy)');
});

test('#3997: a rejection on record, fresh or old, is never shown as a good login', async () => {
  observed.saw(observed.PROVIDER.ANTHROPIC, 'ariaagent', observed.OUTCOME.REJECTED, Date.now());
  observed.saw(observed.PROVIDER.ANTHROPIC, 'bossagent', observed.OUTCOME.REJECTED, Date.now() - 30 * DAY);
  const m = await rows();
  assert.equal(m.get('aria@example.com').badge, 'rejected');
  assert.equal(m.get('aria@example.com').loginValidUntil, undefined, 'a fresh rejection still showed the login as good');
  assert.equal(m.get('boss@example.com').loginValidUntil, undefined, 'an old rejection was overridden by the login date');
  for (const email of ['aria@example.com', 'boss@example.com']) {
    assert.notEqual(m.get(email).badge, 'working', email + ' with a rejection on record was shown green');
    assert.notEqual(m.get(email).observedFrom, 'login', email + ' with a rejection on record was greened by its login');
  }
});

test('#3997: a real request still turns a row green the usual way, and that row is not also a "login good" row', async () => {
  observed.saw(observed.PROVIDER.ANTHROPIC, 'bossagent', observed.OUTCOME.OK, Date.now());
  const m = await rows();
  assert.equal(m.get('boss@example.com').badge, 'working');
  assert.equal(m.get('boss@example.com').loginValidUntil, undefined);
  assert.notEqual(m.get('boss@example.com').observedFrom, 'login');
});

test('#3997 ruling A: the switch is on (Josh, 10-02), and only rows whose login is good are greened by it', async () => {
  assert.equal(claudeloginlive.GREEN_FROM_LOGIN, true, 'the switch is off, so a signed-in Claude account stays grey (Josh, 10-02)');
  const m = await rows();
  for (const [email, c] of m) {
    if (c.observedFrom === 'login') assert.ok(Number.isFinite(c.loginValidUntil) && c.loginValidUntil > Date.now(), email + ' was greened without a good login: ' + JSON.stringify(c));
  }
});

/* #3997 review 1: a Check now that Anthropic refuses without the dead-sign-in words (a 403, a disabled organisation)
   records no outcome, so the login-green must not outlive it; capacity is not a failure and keeps the green. */
async function checkNow(dir) {
  const res = await fetch(base + '/api/accounts/claude/check', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir }),
  });
  return { status: res.status, body: await res.json() };
}
test('#3997 review 1: a failed Check now (non-zero, not capacity, not a dead sign-in) takes the login-green away until a later check answers', async () => {
  const before = await rows();
  assert.equal(before.get('aria@example.com').observedFrom, 'login', 'premise: aria starts green from its login');
  create.setClaudeProbe(async () => ({ exitCode: 1, out: 'API Error: 403 {"type":"error","error":{"type":"permission_error","message":"This organization has been disabled."}}' }));
  try {
    const r = await checkNow(ARIA_DIR);
    assert.equal(r.body.state, 'unknown');
    const m = await rows();
    assert.notEqual(m.get('aria@example.com').badge, 'working', 'a refused Check now left the row green: ' + JSON.stringify(m.get('aria@example.com')));
    assert.notEqual(m.get('aria@example.com').observedFrom, 'login');
    // Per-row: boss, never checked, keeps its login-green.
    assert.equal(m.get('boss@example.com').observedFrom, 'login', 'the refusal leaked to another account');
  } finally { create.setClaudeProbe(null); }
  // A later Check now that answers connected clears it (green from the check itself).
  create.setClaudeProbe(async () => ({ exitCode: 0, out: 'ok' }));
  try {
    await checkNow(ARIA_DIR);
    const m = await rows();
    assert.equal(m.get('aria@example.com').badge, 'working', 'a good check after a refusal did not turn the row green');
    // Review 3: the green above would show from the fresh check alone; the mark itself must be gone too.
    assert.equal(claudeloginlive.checkRefused(ARIA_DIR), false, 'a connected Check now did not clear the failed-check mark');
  } finally { create.setClaudeProbe(null); }
});
test('#3997 review 1 control: capacity is not a failure, and keeps the login-green', async () => {
  create.setClaudeProbe(async () => ({ exitCode: 1, out: 'API Error: 429 rate_limit_error: usage limit reached' }));
  try {
    const r = await checkNow(ARIA_DIR);
    assert.equal(r.body.state, 'unknown');
    const m = await rows();
    assert.equal(m.get('aria@example.com').observedFrom, 'login', 'a capacity answer took the green away: ' + JSON.stringify(m.get('aria@example.com')));
  } finally { create.setClaudeProbe(null); }
});
