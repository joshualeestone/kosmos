'use strict';
/**
 * #2420: the POST /api/accounts/claude/apikey route wires the claudeaccounts
 * key module to HTTP. Tests the ROUTING (validation, needsRunner, live-refusal of
 * a bad key, secure storage, the response never carrying the key) with the runner
 * resolver MOCKED (never touches the machine's claude) and the live check driven
 * through claudeAccounts.setFetcher (never a real Anthropic call). The module's own
 * logic is covered by engine/claudeaccounts.test.js.
 *
 *   node --test server.claude-apikey-2420.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-claude-apikey-routes-2420-'));
const mkTemp = (p) => fs.mkdtempSync(nodePath.join(os.tmpdir(), p));
// Sandbox EVERY fleet root, or server.js refuses a half-sandboxed boot (#634).
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkTemp('aw-ck-workers-');
process.env.AGENT_WORKFORCE_PROJECTS = mkTemp('aw-ck-projects-');
process.env.AGENT_WORKFORCE_LAUNCH = mkTemp('aw-ck-launch-');
process.env.AGENT_WORKFORCE_TMUX_BIN = nodePath.join(__dirname, 'test-support', 'fake-tmux.sh');

const claudeAccounts = require('./engine/claudeaccounts');
const runners = require('./engine/runners');
const { start, server } = require('./server');

// Runner PRESENT so the route reaches key validation (never the machine's claude).
runners.resolveBin = () => ({ present: true, bin: '/mock/claude' });
runners.status = () => ({ claude: { job: { phase: 'installed' } } });

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { claudeAccounts.setFetcher(null); try { server.close(); } catch { /* best effort */ } try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
test.afterEach(() => claudeAccounts.setFetcher(null));

const post = (p, obj) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });

test('a good key: 200, connection state, and the response NEVER carries the key', async () => {
  claudeAccounts.setFetcher(async () => ({ status: 200, body: { data: [] } }));
  const r = await post('/api/accounts/claude/apikey', { label: 'work-key', key: 'sk-ant-api03-goodkey-shouldnotappear' });
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.account.label, 'work-key');
  assert.equal(b.account.connection.state, claudeAccounts.STATE.CONNECTED);
  assert.ok(!JSON.stringify(b).includes('goodkey'), 'the response must never carry the key');
  // The account dir was configured: settings.json has the apiKeyHelper POINTER (not the key), and the key is in a mode-600 file.
  const dir = nodePath.join(SANDBOX, '.claude-work-key');
  const settings = JSON.parse(fs.readFileSync(nodePath.join(dir, 'settings.json'), 'utf8'));
  assert.equal(settings.apiKeyHelper, claudeAccounts.apiKeyHelperCommand(dir), 'settings carries the pointer command');
  assert.ok(!JSON.stringify(settings).includes('goodkey'), 'the raw key must never land in settings.json');
  const mode = fs.statSync(claudeAccounts.keyFile(dir)).mode & 0o777;
  assert.equal(mode, 0o600, 'the stored key file is owner-only');
});

test('a positively-rejected key is refused at ENTRY (#1315), and no account dir is left behind', async () => {
  claudeAccounts.setFetcher(async () => ({ status: 401, body: { error: { type: 'authentication_error' } } }));
  const r = await post('/api/accounts/claude/apikey', { label: 'bad-key', key: 'sk-ant-api03-deadkey' });
  assert.equal(r.status, 400);
  const b = await r.json();
  assert.match(b.error, /did not accept this key/);
  assert.equal(fs.existsSync(nodePath.join(SANDBOX, '.claude-bad-key')), false, 'validate-before-prepare means a rejected key makes no litter dir');
});

test('an unreachable/ambiguous check is ACCEPTED, never blocking a good key on a non-confirming answer', async () => {
  claudeAccounts.setFetcher(async () => ({ status: 0, unreachable: true, because: 'we could not reach Anthropic to check whether this key still works' }));
  const r = await post('/api/accounts/claude/apikey', { label: 'maybe-key', key: 'sk-ant-api03-unconfirmed' });
  assert.equal(r.status, 200, 'unreachable is not a positive rejection, so the add stands');
  const b = await r.json();
  assert.equal(b.account.connection.state, claudeAccounts.STATE.UNKNOWN);
});

test('a shape-bad key is refused in words before any network call', async () => {
  let called = false;
  claudeAccounts.setFetcher(async () => { called = true; return { status: 200, body: {} }; });
  const r = await post('/api/accounts/claude/apikey', { label: 'x', key: 'has a space' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /no spaces/);
  assert.equal(called, false, 'a shape-bad key never reaches the network');
});

test('a label matching an existing SUBSCRIPTION account is refused, and that account is NOT switched to the key (#2420 BLOCKER)', async () => {
  // Plant a signed-in subscription account (a .claude.json with an oauthAccount) at
  // the dir the label maps to. accounts.prepare would mkdir it and return ok, so the
  // guard must refuse before any key/apiKeyHelper touches it.
  const dir = nodePath.join(SANDBOX, '.claude-sub-acct');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'sub@example.com' } }));
  claudeAccounts.setFetcher(async () => ({ status: 200, body: {} }));
  const r = await post('/api/accounts/claude/apikey', { label: 'sub-acct', key: 'sk-ant-would-switch-billing' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /already a Claude account/);
  assert.equal(fs.existsSync(claudeAccounts.keyFile(dir)), false, 'no key file dropped into the subscription account');
  const cfg = JSON.parse(fs.readFileSync(nodePath.join(dir, '.claude.json'), 'utf8'));
  assert.equal(cfg.oauthAccount.emailAddress, 'sub@example.com', 'the subscription account is untouched');
  // And settings.json (if prepare created one) must NOT carry an apiKeyHelper.
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(nodePath.join(dir, 'settings.json'), 'utf8')); } catch { /* none */ }
  assert.equal('apiKeyHelper' in settings, false, 'the subscription account was never repointed to the key');
});

test('re-adding the SAME label as an existing api-key account is refused (no silent overwrite)', async () => {
  claudeAccounts.setFetcher(async () => ({ status: 200, body: {} }));
  const first = await post('/api/accounts/claude/apikey', { label: 'dup-acct', key: 'sk-ant-api03-first-longenoughkey' });
  assert.equal(first.status, 200);
  const second = await post('/api/accounts/claude/apikey', { label: 'dup-acct', key: 'sk-ant-api03-second-longenoughkey' });
  assert.equal(second.status, 400);
  assert.match((await second.json()).error, /already a Claude account/);
  const stored = fs.readFileSync(claudeAccounts.keyFile(nodePath.join(SANDBOX, '.claude-dup-acct')), 'utf8');
  assert.equal(stored, 'sk-ant-api03-first-longenoughkey', 'the first key is not silently overwritten by the second');
});

test('a label that sanitizes to empty is refused in words, and a key with surrounding whitespace is trimmed before storage', async () => {
  claudeAccounts.setFetcher(async () => ({ status: 200, body: {} }));
  const empty = await post('/api/accounts/claude/apikey', { label: '!!!', key: 'sk-ant-api03-validlongkey' });
  assert.equal(empty.status, 400);
  assert.match((await empty.json()).error, /not a name we can use/);

  const r = await post('/api/accounts/claude/apikey', { label: 'ws-key', key: '\n  sk-ant-api03-whitespace-wrapped  \n' });
  assert.equal(r.status, 200);
  const stored = fs.readFileSync(claudeAccounts.keyFile(nodePath.join(SANDBOX, '.claude-ws-key')), 'utf8');
  assert.equal(stored, 'sk-ant-api03-whitespace-wrapped', 'the key is trimmed, so apiKeyHelper cats exactly the key with no stray whitespace');
});

test('runner missing -> needsRunner, before the key is even looked at', async () => {
  const savedResolve = runners.resolveBin;
  runners.resolveBin = () => ({ present: false });
  try {
    const r = await post('/api/accounts/claude/apikey', { label: 'y', key: 'sk-ant-whatever' });
    assert.equal(r.status, 400);
    const b = await r.json();
    assert.equal(b.needsRunner, true);
    assert.equal(b.provider, 'claude');
  } finally { runners.resolveBin = savedResolve; }
});
