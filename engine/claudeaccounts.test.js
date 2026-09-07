'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const ca = require('./claudeaccounts');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-claude-apikey-2420-'));
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
test.afterEach(() => ca.setFetcher(null));

function freshDir(name) {
  const d = nodePath.join(SANDBOX, name);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

test('keyProblem: empty / whitespace / too-short are refused in words; a plausible key passes', () => {
  assert.equal(ca.keyProblem(''), 'paste the key first');
  assert.equal(ca.keyProblem('   '), 'paste the key first');
  assert.match(ca.keyProblem('sk-ant with a space'), /no spaces/);
  assert.match(ca.keyProblem('short'), /too short/);
  assert.equal(ca.keyProblem('sk-ant-api03-' + 'x'.repeat(40)), null, 'a plausible key has no shape complaint');
});

test('validateLive asymmetry: 200 CONNECTED, authentication_error NONE, other-401 UNKNOWN, unreachable UNKNOWN', async () => {
  ca.setFetcher(async () => ({ status: 200, body: { data: [] } }));
  assert.equal((await ca.validateLive('sk-ant-good')).state, ca.STATE.CONNECTED);

  ca.setFetcher(async () => ({ status: 401, body: { error: { type: 'authentication_error' } } }));
  assert.equal((await ca.validateLive('sk-ant-bad')).state, ca.STATE.NONE, 'a positively-attributed bad key is NONE');

  // A 401 WITHOUT authentication_error (e.g. a permissions/scoping refusal) must NOT be
  // guessed as a dead key -- the same asymmetry openaiaccounts.checkLive keeps.
  ca.setFetcher(async () => ({ status: 401, body: { error: { type: 'permission_error' } } }));
  assert.equal((await ca.validateLive('sk-ant-scoped')).state, ca.STATE.UNKNOWN, 'a non-attributed 401 is UNKNOWN, never a guessed NONE');

  ca.setFetcher(async () => ({ status: 0, unreachable: true, because: 'we could not reach Anthropic to check whether this key still works' }));
  assert.equal((await ca.validateLive('sk-ant-x')).state, ca.STATE.UNKNOWN, 'unreachable is UNKNOWN, never NONE');
});

test('askModels sends x-api-key AND the required anthropic-version, and never the Authorization bearer shape', async () => {
  let seen = null;
  ca.setFetcher(async (url, init) => { seen = { url, headers: init.headers }; return { status: 200, body: {} }; });
  await ca.validateLive('sk-ant-probe');
  assert.equal(seen.headers['x-api-key'], 'sk-ant-probe');
  assert.ok(seen.headers['anthropic-version'], 'anthropic-version is required by the API; a call without it is a 400, not a key verdict');
  assert.equal(seen.headers.authorization, undefined, 'Anthropic uses x-api-key, not a Bearer Authorization header');
});

test('storeKey writes mode 0600 without a trailing newline, and readKey round-trips it', () => {
  const dir = freshDir('store1');
  ca.storeKey(dir, '  sk-ant-secret-123  ');
  const mode = fs.statSync(ca.keyFile(dir)).mode & 0o777;
  assert.equal(mode, 0o600, 'the key file must be owner-only (0600)');
  assert.equal(fs.readFileSync(ca.keyFile(dir), 'utf8'), 'sk-ant-secret-123', 'stored trimmed, no trailing newline, so apiKeyHelper cats exactly the key');
  assert.equal(ca.readKey(dir), 'sk-ant-secret-123');
});

test('the raw key is NEVER written into settings.json: wireApiKeyHelper stores only the cat-the-file POINTER', () => {
  const dir = freshDir('wire1');
  const settings = nodePath.join(dir, 'settings.json');
  fs.writeFileSync(settings, JSON.stringify({ hooks: { SessionStart: [] } }, null, 2));
  ca.storeKey(dir, 'sk-ant-topsecret-should-never-appear');
  const r = ca.wireApiKeyHelper(settings, dir);
  assert.equal(r.wired, true);
  const raw = fs.readFileSync(settings, 'utf8');
  assert.ok(!raw.includes('sk-ant-topsecret'), 'the raw key must NEVER appear in settings.json -- only the apiKeyHelper command');
  const obj = JSON.parse(raw);
  assert.equal(obj.apiKeyHelper, ca.apiKeyHelperCommand(dir), 'settings carries the pointer command');
  assert.deepEqual(obj.hooks, { SessionStart: [] }, 'existing settings (the reporting hooks) are preserved, never clobbered');
  // The apiKeyHelper command, when run, must emit exactly the key on stdout.
  const out = require('node:child_process').execSync(obj.apiKeyHelper, { encoding: 'utf8' });
  assert.equal(out, 'sk-ant-topsecret-should-never-appear', 'apiKeyHelper resolves to exactly the stored key');
});

test('checkLive: absent key file is a positive NONE; a present key is verified live', async () => {
  const dir = freshDir('check1');
  let live = await ca.checkLive(dir);
  assert.equal(live.state, ca.STATE.NONE, 'no key stored -> positively NONE (nobody configured a key here)');

  ca.storeKey(dir, 'sk-ant-live');
  ca.setFetcher(async () => ({ status: 200, body: {} }));
  live = await ca.checkLive(dir);
  assert.equal(live.state, ca.STATE.CONNECTED, 'a stored key that Anthropic accepts is CONNECTED');
  assert.equal(live.checkedLive, true);
});

test('forget takes back BOTH the key file and the apiKeyHelper entry, leaving other settings', () => {
  const dir = freshDir('forget1');
  const settings = nodePath.join(dir, 'settings.json');
  fs.writeFileSync(settings, JSON.stringify({ theme: 'dark' }, null, 2));
  ca.storeKey(dir, 'sk-ant-todelete');
  ca.wireApiKeyHelper(settings, dir);
  assert.equal(ca.readKey(dir), 'sk-ant-todelete');

  assert.equal(ca.forgetKey(dir), true);
  assert.equal(fs.existsSync(ca.keyFile(dir)), false, 'the key file is gone');
  const un = ca.unwireApiKeyHelper(settings);
  assert.equal(un.unwired, true);
  const obj = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.equal('apiKeyHelper' in obj, false, 'the pointer is removed');
  assert.equal(obj.theme, 'dark', 'unrelated settings survive the untwire');
});
