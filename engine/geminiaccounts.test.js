'use strict';
/**
 * #3296 accounts slice: engine/geminiaccounts.js -- the Gemini (Google) account
 * module. Structurally the grok module with Google's key-check (the key rides the
 * QUERY STRING, not a Bearer header) and Google's API_KEY_INVALID rejection shape.
 * The CLI's `.gemini`-storage-subdir quirk is NOT this module's concern (it lives in
 * create.geminiStorageHome); here `dir` is the account dir == GEMINI_CLI_HOME verbatim.
 *
 *   node --test engine/geminiaccounts.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-geminiaccounts-3296-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_GEMINI_HOME = nodePath.join(SANDBOX, '.gemini');

const ma = require('./geminiaccounts');

test.afterEach(() => ma.setFetcher(null));
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

function clean() {
  for (const n of fs.readdirSync(SANDBOX)) {
    if (n.startsWith('.gemini') || n.startsWith('.removed-gemini-')) fs.rmSync(nodePath.join(SANDBOX, n), { recursive: true, force: true });
  }
}

test('validateLive asymmetry: 200 CONNECTED, API_KEY_INVALID NONE, generic 403 UNKNOWN, unreachable UNKNOWN', async () => {
  ma.setFetcher(async () => ({ status: 200, body: { models: [] } }));
  assert.equal((await ma.validateLive('AIza-good')).state, ma.STATE.CONNECTED);

  // Google's real invalid-key response: the structured reason enum in error.details.
  ma.setFetcher(async () => ({ status: 400, body: { error: { status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.', details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID', domain: 'googleapis.com' }] } } }));
  assert.equal((await ma.validateLive('AIza-bad')).state, ma.STATE.NONE, 'the structured API_KEY_INVALID reason is a positive NONE');

  // 🛑 The free-text message ALONE must NOT red a key -- only the structured reason does.
  // A 400 whose prose says "API key not valid" but carries no API_KEY_INVALID reason is
  // UNKNOWN, or a fuzzy message match would red a good key on incidental wording.
  ma.setFetcher(async () => ({ status: 400, body: { error: { status: 'INVALID_ARGUMENT', message: 'API key not valid for this request' } } }));
  assert.equal((await ma.validateLive('AIza-msgonly')).state, ma.STATE.UNKNOWN, 'a free-text-only message is UNKNOWN, never a guessed NONE');

  // A generic PERMISSION_DENIED without an API_KEY_INVALID reason is a scope answer,
  // never a guessed dead key.
  ma.setFetcher(async () => ({ status: 403, body: { error: { status: 'PERMISSION_DENIED', message: 'Method not allowed for this key' } } }));
  assert.equal((await ma.validateLive('AIza-scoped')).state, ma.STATE.UNKNOWN, 'a non-attributed refusal is UNKNOWN');

  ma.setFetcher(async () => ({ status: 0, unreachable: true, because: 'we could not reach Google to check whether this key still works' }));
  assert.equal((await ma.validateLive('AIza-x')).state, ma.STATE.UNKNOWN);
});

test('askModels puts the key in the QUERY STRING (url-encoded), not an Authorization header', async () => {
  let seen = null;
  ma.setFetcher(async (url, init) => { seen = { url, init }; return { status: 200, body: {} }; });
  await ma.validateLive('AIza needs+encoding');
  assert.match(seen.url, /generativelanguage\.googleapis\.com\/v1beta\/models/);
  assert.match(seen.url, /[?&]key=AIza%20needs%2Bencoding/, 'the key rides the query string, URL-encoded');
  assert.ok(!seen.init || !seen.init.headers || !seen.init.headers.authorization, 'Google keys are not a Bearer header');
});

test('storeKey/identityOf: the key file lives in the account dir; identity is the last four', () => {
  clean();
  const { dir } = ma.dirForLabel('work');
  ma.storeKey(dir, 'AIzaSyExample-key-tail1234');
  assert.equal(fs.statSync(ma.keyFile(dir)).mode & 0o777, 0o600);
  assert.equal(ma.keyFile(dir), nodePath.join(dir, '.kosmos-gemini-apikey'), 'the key file is inside the account dir (== GEMINI_CLI_HOME)');
  assert.deepEqual(ma.identityOf(dir), { authMode: 'apikey', email: null, keyTail: '1234' });
});

test('list: default gated on a key; a named account lists with label + tail; row.dir is the account dir', () => {
  clean();
  assert.deepEqual(ma.list(), []);
  const { dir } = ma.dirForLabel('main');
  ma.storeKey(dir, 'AIza-mmmm-key-9999');
  const rows = ma.list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].provider, 'google');
  assert.equal(rows[0].providerName, 'Gemini');
  assert.equal(rows[0].label, 'main');
  assert.equal(rows[0].keyTail, '9999');
  assert.equal(rows[0].dir, dir);
  assert.equal(nodePath.basename(rows[0].dir), '.gemini-main', 'row.dir is the labelled account dir, not a nested .gemini');
});

test('checkLive: absent = NONE, empty = UNKNOWN, live 200 = CONNECTED', async () => {
  clean();
  const { dir } = ma.dirForLabel('live');
  fs.mkdirSync(dir, { recursive: true });
  assert.equal((await ma.checkLive(dir)).state, ma.STATE.NONE);
  ma.storeKey(dir, '');
  assert.equal((await ma.checkLive(dir)).state, ma.STATE.UNKNOWN);
  ma.storeKey(dir, 'AIza-live-0000');
  ma.setFetcher(async () => ({ status: 200, body: {} }));
  assert.equal((await ma.checkLive(dir)).state, ma.STATE.CONNECTED);
});

test('forgetAccount renames the account dir aside, refuses a used account and a name-shaped non-account', () => {
  clean();
  const { dir } = ma.dirForLabel('forgetme');
  ma.storeKey(dir, 'AIza-forget-7777');
  assert.equal(ma.forgetAccount(dir, ['renet']).ok, false, 'a used account is refused');
  const f = ma.forgetAccount(dir, []);
  assert.equal(f.ok, true);
  assert.equal(fs.existsSync(dir), false);
  assert.equal(fs.existsSync(f.movedTo), true, 'reversible: the credential survives');
  const bogus = nodePath.join(SANDBOX, '.gemini-notanaccount');
  fs.mkdirSync(bogus, { recursive: true });
  const r = ma.forgetAccount(bogus, []);
  assert.equal(r.ok, false);
  assert.equal(fs.existsSync(bogus), true, 'a non-account folder is left untouched');
});

test('removeAccount deletes the credential; same guards as forget', () => {
  clean();
  const { dir } = ma.dirForLabel('removeme');
  ma.storeKey(dir, 'AIza-remove-5555');
  assert.equal(ma.removeAccount(dir, ['x']).ok, false);
  const r = ma.removeAccount(dir, []);
  assert.equal(r.ok, true);
  assert.equal(r.removed, true);
  assert.equal(fs.existsSync(dir), false);
});

test('nextWorkDir hands out the first free work slot and skips an occupied one', () => {
  clean();
  const first = ma.nextWorkDir();
  assert.equal(first.label, 'work1');
  ma.storeKey(first.dir, 'AIza-occupied-1111');
  assert.equal(ma.nextWorkDir().label, 'work2');
});
