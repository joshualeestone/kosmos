'use strict';
/* #3997 (reopened, ruling C): an idle, signed-in Claude account shows its login as good ("Signed in · login good
   until <date>", calm and neutral), read from its own login date, and never turns green from that alone.
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

test('#3997: an idle sign-in with a login ahead carries its date, and stays unverified (not green)', async () => {
  const m = await rows();
  for (const email of ['boss@example.com', 'aria@example.com']) {
    assert.equal(m.get(email).badge, 'signed_in_unverified', email + ' changed badge: ' + JSON.stringify(m.get(email)));
    assert.equal(m.get(email).loginValidUntil, FUTURE, email + ' did not carry its login date');
  }
  assert.equal(m.get('cleo@example.com').badge, 'signed_in_unverified');
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
});

test('#3997: a real request still turns a row green the usual way, and that row is not also a "login good" row', async () => {
  observed.saw(observed.PROVIDER.ANTHROPIC, 'bossagent', observed.OUTCOME.OK, Date.now());
  const m = await rows();
  assert.equal(m.get('boss@example.com').badge, 'working');
  assert.equal(m.get('boss@example.com').loginValidUntil, undefined);
  assert.notEqual(m.get('boss@example.com').observedFrom, 'login');
});

test('#3997 ruling C: with the switch off, a login alone never turns a row green', async () => {
  assert.equal(claudeloginlive.GREEN_FROM_LOGIN, false, 'the switch is on, which Liu Kang ruled against until Josh says otherwise');
  const m = await rows();
  for (const [email, c] of m) assert.notEqual(c.observedFrom, 'login', email + ' was greened by its login');
});
