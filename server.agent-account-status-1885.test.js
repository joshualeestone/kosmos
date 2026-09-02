/**
 * #1885: GET /api/agent/:name/account-status, driven over HTTP.
 *
 * 🛑 THE BUG. A Claude credential is stored per config dir, and an agent runs
 * under its OWN CLAUDE_CONFIG_DIR. A real tester re-authenticated his own Claude
 * (the DEFAULT dir) and his agent -- on a DIFFERENT, suffixed dir -- stayed 401,
 * while Settings said "connected". Settings is honest but per-ACCOUNT; nothing
 * mapped his agent to its dead dir. This route answers the per-AGENT question,
 * and the test that matters is exactly the one Splinter named: with a LIVE
 * default sign-in and a DEAD suffixed one, the agent on the suffixed dir must
 * read NOT connected while the agent on the default reads connected.
 *
 * 🔑 The auth-status subprocess is faked with `subscription.setRunner` -- the
 * module's own seam for that external call, used throughout its unit tests -- so
 * no real `claude` runs and no credential value is ever printed. Everything else
 * (accountForAgent's record read, accounts.list, checkLive's per-dir scoping) is
 * the REAL path: the fake supplies only the one thing the machine cannot in a
 * test, whether OpenAI/Anthropic accepts the token.
 *
 * 🛑 SEALS AGENT_WORKFORCE_HOME (and the codex roots) BEFORE requiring anything,
 * the same rule server.switch-account-1373.test.js states: an unsealed home
 * reads the operator's real ~/.claude-* / ~/.codex-* sign-ins into the fixture.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'srv-acct-status-1885-'));
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

/* A Claude account is a config dir whose `.claude.json` carries an oauthAccount.
   The DEFAULT's record sits BESIDE ~/.claude (at ~/.claude.json); a labelled
   dir keeps its own inside it. */
fs.writeFileSync(nodePath.join(HOME, '.claude.json'),
  JSON.stringify({ oauthAccount: { emailAddress: 'boss@example.com' } }));
fs.mkdirSync(nodePath.join(HOME, '.claude', 'projects'), { recursive: true });

const ARIA_DIR = nodePath.join(HOME, '.claude-aria');
fs.mkdirSync(nodePath.join(ARIA_DIR, 'projects'), { recursive: true });
fs.writeFileSync(nodePath.join(ARIA_DIR, '.claude.json'),
  JSON.stringify({ oauthAccount: { emailAddress: 'aria@example.com' } }));

/* Two agents: `aria` launched onto the suffixed dir, `boss` onto the default
   (no CLAUDE_CONFIG_DIR in its plist). The route reads the RECORD, so no running
   pane is needed. */
function born(name, configDir) {
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(create.plistPath(name),
    create.plistFor(name, CLAUDE_BIN, TMUX_BIN, null, configDir, 'claude'), 'utf8');
  return name;
}
born('aria', ARIA_DIR);
born('boss', null);

/* The one faked boundary: `claude auth status`. It answers per config dir, the
   way the real command does -- the suffixed dir's sign-in is dead, the default's
   is live -- so the route's per-dir scoping is what decides each answer. */
subscription.setRunner(async (env) => {
  const dir = env && env.CLAUDE_CONFIG_DIR;
  if (dir && dir.indexOf('.claude-aria') !== -1) {
    return { stdout: JSON.stringify({ loggedIn: false, authMethod: 'none' }), err: null };
  }
  return { stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max', email: 'boss@example.com' }), err: null };
});

const { start, server } = require('./server');
let base = '';
test.before(async () => { await start(0); base = 'http://127.0.0.1:' + server.address().port; });
test.after(() => {
  try { server.close(); } catch { /* the port is going away anyway */ }
  subscription.setRunner(null);
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

async function statusOf(name) {
  const res = await fetch(base + '/api/agent/' + encodeURIComponent(name) + '/account-status');
  return { status: res.status, body: await res.json() };
}

test('#1885 CONTROL: the fixture really holds two distinct accounts, or nothing below means anything', () => {
  const dirs = accounts.list().map((a) => a.dir);
  assert.ok(dirs.some((d) => d.indexOf('.claude-aria') !== -1), 'the suffixed account is not listed: ' + JSON.stringify(dirs));
  assert.ok(dirs.length >= 2, 'the fixture does not hold both the default and the suffixed account: ' + JSON.stringify(dirs));
  for (const d of dirs) assert.ok(d.startsWith(SANDBOX), 'an account outside the sandbox leaked in: ' + d);
});

test('#1885: an agent on a DEAD suffixed config dir reads NOT connected, and names the remedy', async () => {
  const r = await statusOf('aria');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.equal(r.body.connected, false, 'the agent on the dead suffixed dir read as connected: ' + JSON.stringify(r.body));
  assert.equal(r.body.state, 'none');
  assert.match(r.body.remedy || '', /Re-authenticate this agent/, 'the remedy must name this agent, not the account: ' + JSON.stringify(r.body));
  assert.equal(r.body.account.email, 'aria@example.com', 'the answer is about the wrong account');
});

test('#1885: an agent on the LIVE default account reads connected, no remedy -- proving the route reads EACH agent\'s OWN dir', async () => {
  const r = await statusOf('boss');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.equal(r.body.connected, true, 'the agent on the live default read as not connected: ' + JSON.stringify(r.body));
  assert.equal(r.body.state, 'connected');
  assert.equal(r.body.remedy, null);
  /* 🔑 THE PAIR IS THE PROOF. aria (suffixed) and boss (default) get OPPOSITE
     answers from the SAME route in the same run, which can only happen if the
     route scoped checkLive to each agent's own config dir -- the exact
     dir-mismatch the bug turned on. A route that read one fixed dir would give
     both the same answer. */
});

test('#1885: an unconfirmable sign-in is UNKNOWN (connected:null), never a guessed negative', async () => {
  const prev = subscription.setRunner;
  subscription.setRunner(async () => { throw new Error('getaddrinfo ENOTFOUND'); });
  try {
    const r = await statusOf('aria');
    assert.equal(r.body.ok, true, JSON.stringify(r.body));
    assert.equal(r.body.connected, null, 'an unreachable check was reported as a definite not-connected: ' + JSON.stringify(r.body));
    assert.equal(r.body.state, 'unknown');
    assert.equal(r.body.remedy, null, 'a remedy was offered for a state we could not confirm');
  } finally {
    // Restore the per-dir runner for any later test in this file.
    subscription.setRunner(async (env) => {
      const dir = env && env.CLAUDE_CONFIG_DIR;
      if (dir && dir.indexOf('.claude-aria') !== -1) return { stdout: JSON.stringify({ loggedIn: false, authMethod: 'none' }), err: null };
      return { stdout: JSON.stringify({ loggedIn: true, subscriptionType: 'max' }), err: null };
    });
  }
});

test('#1885: an unknown agent name is answered honestly, not as a connected account', async () => {
  const r = await statusOf('not-an-agent-here');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, false);
  assert.match(r.body.because || '', /which account this agent runs on/);
});
