/**
 * #1903: create must not hand a new agent an account that cannot sign in.
 *
 * 🛑 THE INCIDENT. A real tester created a fresh Claude agent that reported
 * created, ran, received its first message, and 401'd on its first API call
 * ("OAuth access token has expired"), because create points an agent at the
 * chosen account's config dir and never checked the credential there was live.
 * `create.accountConnectable` is the create-time gate (the #1315 template): it
 * refuses ONLY a positively-confirmed dead sign-in and proceeds on connected,
 * unconfirmable, or unresolvable.
 *
 * The two external boundaries are faked with each module's OWN seam
 * (`subscription.setRunner` for Claude's `claude auth status`,
 * `openaiaccounts.setFetcher` for OpenAI's `/v1/models`) -- never the real
 * network, and no credential value is ever written or asserted.
 *
 * 🛑 Seals AGENT_WORKFORCE_HOME and the codex roots BEFORE requiring anything,
 * the suite rule: an unsealed home reads the operator's real accounts.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'create-connectable-1903-'));
const HOME = nodePath.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.AGENT_WORKFORCE_HOME = HOME;
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;

const create = require('./create');
const subscription = require('./subscription');
const openai = require('./openaiaccounts');

// Default Claude account (record BESIDE ~/.claude) + a labelled one.
fs.writeFileSync(nodePath.join(HOME, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'default@example.com' } }));
fs.mkdirSync(nodePath.join(HOME, '.claude', 'projects'), { recursive: true });
const DEAD_CLAUDE = nodePath.join(HOME, '.claude-dead');
fs.mkdirSync(nodePath.join(DEAD_CLAUDE, 'projects'), { recursive: true });
fs.writeFileSync(nodePath.join(DEAD_CLAUDE, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'dead@example.com' } }));

// An OpenAI account (codex apikey home).
const DEAD_OPENAI = nodePath.join(HOME, '.codex-dead');
fs.mkdirSync(DEAD_OPENAI, { recursive: true });
fs.writeFileSync(nodePath.join(DEAD_OPENAI, 'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-deadkeydeadkeyDEAD' }));

test.after(() => {
  subscription.setRunner(null); openai.setFetcher(null);
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

test('#1903 CONTROL: the fixture accounts are actually listed, or nothing below means anything', () => {
  const claudeDirs = require('./accounts').list().map((a) => a.dir);
  assert.ok(claudeDirs.some((d) => d.indexOf('.claude-dead') !== -1), 'dead Claude account not listed: ' + JSON.stringify(claudeDirs));
  assert.ok(openai.list().some((a) => a.dir.indexOf('.codex-dead') !== -1), 'dead OpenAI account not listed');
  for (const d of claudeDirs) assert.ok(d.startsWith(SANDBOX), 'a real account leaked in: ' + d);
});

test('#1903: a Claude account whose sign-in is DEAD is refused, naming the remedy', async () => {
  subscription.setRunner(async () => ({ stdout: JSON.stringify({ loggedIn: false, authMethod: 'none' }), err: null }));
  try {
    const r = await create.accountConnectable({ provider: 'anthropic', accountDir: DEAD_CLAUDE });
    assert.equal(r.ok, false, 'a dead Claude account was accepted at create');
    assert.match(r.because, /sign-in is not working/);
    assert.match(r.because, /Re-authenticate/);
  } finally { subscription.setRunner(null); }
});

test('#1903: a Claude account that is CONNECTED is accepted', async () => {
  subscription.setRunner(async () => ({ stdout: JSON.stringify({ loggedIn: true, subscriptionType: 'max' }), err: null }));
  try {
    assert.deepEqual(await create.accountConnectable({ provider: 'anthropic', accountDir: DEAD_CLAUDE }), { ok: true });
  } finally { subscription.setRunner(null); }
});

test('#1903: a Claude account we CANNOT CONFIRM dead is accepted (fail-open, never a false block)', async () => {
  // A 401 without loggedIn:false, or a network throw -> checkLive returns UNKNOWN.
  subscription.setRunner(async () => { throw new Error('getaddrinfo ENOTFOUND'); });
  try {
    assert.deepEqual(await create.accountConnectable({ provider: 'anthropic', accountDir: DEAD_CLAUDE }), { ok: true });
  } finally { subscription.setRunner(null); }
});

test('#1903: an UNKNOWN account is accepted here (createAgentInner owns that refusal)', async () => {
  let asked = false;
  subscription.setRunner(async () => { asked = true; return { stdout: JSON.stringify({ loggedIn: false }), err: null }; });
  try {
    assert.deepEqual(await create.accountConnectable({ provider: 'anthropic', accountDir: nodePath.join(HOME, '.claude-nope') }), { ok: true });
    assert.equal(asked, false, 'the live check ran on an account that is not even known');
  } finally { subscription.setRunner(null); }
});

test('#1903: the DEFAULT account is checked with NO configDir, and a dead default is refused', async () => {
  /* accountConnectable must scope the default like accounts.listLive: no
     configDir, so `claude` reads the real ~/.claude.json and not the decoy.
     The fake is live only when no configDir is passed, so a refusal here proves
     the default was checked unscoped. */
  subscription.setRunner(async (env) => (env && env.CLAUDE_CONFIG_DIR
    ? { stdout: JSON.stringify({ loggedIn: true, subscriptionType: 'max' }), err: null }
    : { stdout: JSON.stringify({ loggedIn: false, authMethod: 'none' }), err: null }));
  try {
    const r = await create.accountConnectable({ provider: 'anthropic', accountDir: '' });
    assert.equal(r.ok, false, 'a dead DEFAULT account was accepted, or it was checked with the wrong (scoped) dir');
    assert.match(r.because, /sign-in is not working/);
  } finally { subscription.setRunner(null); }
});

test('#1903: an OpenAI account whose key OpenAI rejects is refused', async () => {
  openai.setFetcher(async () => ({ status: 401, body: { error: { code: 'invalid_api_key' } } }));
  try {
    const r = await create.accountConnectable({ provider: 'openai', accountDir: DEAD_OPENAI });
    assert.equal(r.ok, false, 'a dead OpenAI account was accepted at create');
    assert.match(r.because, /sign-in is not working/);
  } finally { openai.setFetcher(null); }
});

test('#1903: an OpenAI account OpenAI accepts (200) is accepted, and a scope-restricted 401 is not blocked', async () => {
  openai.setFetcher(async () => ({ status: 200, body: { data: [{ id: 'gpt-4o' }] } }));
  try {
    assert.deepEqual(await create.accountConnectable({ provider: 'openai', accountDir: DEAD_OPENAI }), { ok: true });
  } finally { openai.setFetcher(null); }
  openai.setFetcher(async () => ({ status: 403, body: { error: { code: 'insufficient_permissions' } } }));
  try {
    assert.deepEqual(await create.accountConnectable({ provider: 'openai', accountDir: DEAD_OPENAI }), { ok: true });
  } finally { openai.setFetcher(null); }
});
