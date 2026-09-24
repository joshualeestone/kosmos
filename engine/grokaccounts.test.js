'use strict';
/**
 * #3391 accounts slice: engine/grokaccounts.js -- the Grok (xAI) account module.
 * Mirrors engine/claudeaccounts.test.js + openaiaccounts.test.js. The live check is
 * driven through setFetcher (never a real xAI call); the sandbox home is set via
 * AGENT_WORKFORCE_HOME so list()/scan never read the operator's real ~/.grok*.
 *
 *   node --test engine/grokaccounts.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-grokaccounts-3391-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
// Pin the default home under the sandbox too, so a default row never reads ~/.grok.
process.env.AGENT_WORKFORCE_GROK_HOME = nodePath.join(SANDBOX, '.grok');

const ga = require('./grokaccounts');

test.afterEach(() => ga.setFetcher(null));
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

// A clean slate for a subtest: remove every .grok* dir in the sandbox home.
function clean() {
  for (const n of fs.readdirSync(SANDBOX)) {
    if (n.startsWith('.grok') || n.startsWith('.removed-grok-')) fs.rmSync(nodePath.join(SANDBOX, n), { recursive: true, force: true });
  }
}

test('keyProblem: empty / whitespace / too-short refused in words; a plausible key passes', () => {
  assert.equal(ga.keyProblem(''), 'paste the key first');
  assert.equal(ga.keyProblem('   '), 'paste the key first');
  assert.match(ga.keyProblem('xai key with a space'), /no spaces/);
  assert.match(ga.keyProblem('short'), /too short/);
  assert.equal(ga.keyProblem('xai-' + 'x'.repeat(40)), null, 'a plausible key has no shape complaint');
});

test('validateLive asymmetry: 200 CONNECTED, attributed 401 NONE, non-attributed 401/403 UNKNOWN, unreachable UNKNOWN', async () => {
  ga.setFetcher(async () => ({ status: 200, body: { data: [] } }));
  assert.equal((await ga.validateLive('xai-good')).state, ga.STATE.CONNECTED);

  ga.setFetcher(async () => ({ status: 401, body: { error: { code: 'invalid_api_key', message: 'Incorrect API key provided' } } }));
  assert.equal((await ga.validateLive('xai-bad')).state, ga.STATE.NONE, 'a positively-attributed bad key (structured code) is NONE');

  // A 401/403 that does NOT attribute the failure to the key (a scope/permission
  // answer) must NOT be guessed as a dead key -- the openaiaccounts asymmetry.
  ga.setFetcher(async () => ({ status: 403, body: { error: { code: 'permission_denied', message: 'not allowed to list models' } } }));
  assert.equal((await ga.validateLive('xai-scoped')).state, ga.STATE.UNKNOWN, 'a non-attributed refusal is UNKNOWN, never a guessed NONE');

  // 🛑 The free-text MESSAGE must NOT red a key -- only the structured CODE does. A 401
  // whose message merely mentions "authentication" for an unrelated reason, with a code
  // that is not a key rejection, is UNKNOWN (the #1315/#2140 fuzzy-message class).
  ga.setFetcher(async () => ({ status: 401, body: { error: { code: 'service_unavailable', message: 'the authentication service is temporarily unavailable' } } }));
  assert.equal((await ga.validateLive('xai-msgonly')).state, ga.STATE.UNKNOWN, 'a message mentioning authentication with a non-key code is UNKNOWN, never NONE');

  // The FLAT error shape (code at the top level, error being a message string) must also
  // register as a positive NONE -- xAI's exact models-API error body is unmeasured, so the
  // code reader handles both the nested and the flat shape.
  ga.setFetcher(async () => ({ status: 401, body: { code: 'invalid_api_key', error: 'Incorrect API key provided.' } }));
  assert.equal((await ga.validateLive('xai-flat')).state, ga.STATE.NONE, 'a flat-shaped invalid_api_key is still a positive NONE');

  ga.setFetcher(async () => ({ status: 0, unreachable: true, because: 'we could not reach xAI to check whether this key still works' }));
  assert.equal((await ga.validateLive('xai-x')).state, ga.STATE.UNKNOWN, 'unreachable is UNKNOWN, never NONE');
});

test('askModels sends a Bearer Authorization header and hits the xAI models URL (overridable)', async () => {
  let seen = null;
  ga.setFetcher(async (url, init) => { seen = { url, headers: init.headers }; return { status: 200, body: {} }; });
  await ga.validateLive('xai-probe');
  assert.equal(seen.headers.authorization, 'Bearer xai-probe');
  assert.match(seen.url, /x\.ai\/v1\/models/);
});

test('storeKey writes mode 0600 without a trailing newline; readKey/identityOf round-trip the tail', () => {
  clean();
  const { dir } = ga.dirForLabel('work-key');
  ga.storeKey(dir, '  xai-secret-abcd1234  ');
  const mode = fs.statSync(ga.keyFile(dir)).mode & 0o777;
  assert.equal(mode, 0o600, 'the key file must be owner-only (0600)');
  assert.equal(fs.readFileSync(ga.keyFile(dir), 'utf8'), 'xai-secret-abcd1234', 'stored trimmed, no trailing newline');
  assert.deepEqual(ga.identityOf(dir), { authMode: 'apikey', email: null, keyTail: '1234' }, 'identity is the last four, never the key');
});

test('list: default gated on a key (not listed uncredentialed); a named account lists with label + tail', () => {
  clean();
  assert.deepEqual(ga.list(), [], 'a clean home lists nothing -- the default is not credentialed through this subsystem');
  const { dir } = ga.dirForLabel('main');
  ga.storeKey(dir, 'xai-key-mmmm9999');
  const rows = ga.list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].provider, 'xai');
  assert.equal(rows[0].providerName, 'Grok');
  assert.equal(rows[0].isDefault, false);
  assert.equal(rows[0].label, 'main');
  assert.equal(rows[0].keyTail, '9999');
  assert.equal(rows[0].dir, dir, 'row.dir is the account dir == GROK_HOME verbatim');
});

test('dirForLabel refuses "default" and an empty/garbage label; slugs a label to [a-z0-9-]', () => {
  assert.equal(ga.dirForLabel('default').ok, false);
  assert.equal(ga.dirForLabel('   ').ok, false);
  const d = ga.dirForLabel('My Work Account!');
  assert.equal(d.ok, true);
  assert.equal(d.label, 'my-work-account');
});

test('checkLive: absent key = NONE (positive), unreadable/empty = UNKNOWN, live 200 = CONNECTED', async () => {
  clean();
  const { dir } = ga.dirForLabel('live');
  fs.mkdirSync(dir, { recursive: true });
  // no key file yet
  assert.equal((await ga.checkLive(dir)).state, ga.STATE.NONE, 'no key file is a positive NONE');
  ga.storeKey(dir, ''); // an empty file
  assert.equal((await ga.checkLive(dir)).state, ga.STATE.UNKNOWN, 'an empty stored key is UNKNOWN, never NONE');
  ga.storeKey(dir, 'xai-live-key-0000');
  ga.setFetcher(async () => ({ status: 200, body: {} }));
  assert.equal((await ga.checkLive(dir)).state, ga.STATE.CONNECTED);
});

test('forgetAccount renames aside (reversible), refuses a name-shaped non-account and a used account', () => {
  clean();
  const { dir } = ga.dirForLabel('forgetme');
  ga.storeKey(dir, 'xai-forget-7777');
  // a used account is refused, naming the agents
  const used = ga.forgetAccount(dir, ['renet']);
  assert.equal(used.ok, false);
  assert.match(used.because, /renet/);
  // a real forget renames the dir aside, key preserved
  const f = ga.forgetAccount(dir, []);
  assert.equal(f.ok, true);
  assert.equal(f.forgotten, true);
  assert.equal(fs.existsSync(dir), false, 'the account dir moved');
  assert.equal(fs.existsSync(f.movedTo), true, 'the credential survives the forget (reversible)');
  assert.equal(ga.list().length, 0, 'a forgotten account no longer lists');
  // a name-shaped dir with no key is not an account -- refuse rather than move it
  const bogus = nodePath.join(SANDBOX, '.grok-notanaccount');
  fs.mkdirSync(bogus, { recursive: true });
  fs.writeFileSync(nodePath.join(bogus, 'user-file'), 'mine');
  const r = ga.forgetAccount(bogus, []);
  assert.equal(r.ok, false);
  assert.match(r.because, /not a Grok account/);
  assert.equal(fs.existsSync(bogus), true, 'a non-account folder is left untouched');
});

test('removeAccount deletes the credential (irreversible), same guards as forget', () => {
  clean();
  const { dir } = ga.dirForLabel('removeme');
  ga.storeKey(dir, 'xai-remove-5555');
  assert.equal(ga.removeAccount(dir, ['someone']).ok, false, 'a used account is refused');
  const r = ga.removeAccount(dir, []);
  assert.equal(r.ok, true);
  assert.equal(r.removed, true);
  assert.equal(fs.existsSync(dir), false, 'the dir and its key are gone');
});

test('nextWorkDir hands out the first free work slot and skips an occupied one', () => {
  clean();
  const first = ga.nextWorkDir();
  assert.equal(first.label, 'work1');
  ga.storeKey(first.dir, 'xai-occupied-1111');
  const second = ga.nextWorkDir();
  assert.equal(second.label, 'work2', 'a slot holding a key is occupied');
});

test('forget/removeAccount REFUSE the default home even if a key file is placed in it (no rmSync of the CLI home)', () => {
  clean();
  const def = ga.defaultDir();
  fs.mkdirSync(def, { recursive: true });
  fs.writeFileSync(ga.keyFile(def), 'xai-manually-placed-9999', { mode: 0o600 }); // identityOf would pass
  const f = ga.forgetAccount(def, []);
  assert.equal(f.ok, false, 'the default is not a managed account and must not be renamed aside');
  assert.match(f.because, /default Grok account/);
  const r = ga.removeAccount(def, []);
  assert.equal(r.ok, false, 'the default must never be rmSync-d -- it is the whole ~/.grok CLI home');
  assert.match(r.because, /default Grok account/);
  assert.ok(fs.existsSync(def), 'the default home is untouched by both');
  fs.rmSync(def, { recursive: true, force: true });
});

test('a symlink account dir is never managed: storeKey throws (no write THROUGH into a real home), forget/remove refuse it', () => {
  clean();
  const real = nodePath.join(SANDBOX, 'real-grok-home');
  fs.mkdirSync(real, { recursive: true });
  const link = nodePath.join(SANDBOX, '.grok-evil');
  try { fs.symlinkSync(real, link); } catch { /* symlinks unsupported here */ }
  if (!(() => { try { return fs.lstatSync(link).isSymbolicLink(); } catch { return false; } })()) { console.log('# symlinks unsupported -- skipping'); return; }
  assert.throws(() => ga.storeKey(link, 'xai-should-not-write-1234'), /symlink/, 'storeKey refuses to write through a symlink');
  assert.equal(fs.existsSync(nodePath.join(real, '.kosmos-grok-apikey')), false, 'no key was written into the symlink target');
  // plant a key directly in the target so identityOf would pass, then confirm forget/remove refuse the symlink
  fs.writeFileSync(nodePath.join(real, '.kosmos-grok-apikey'), 'xai-planted-9999', { mode: 0o600 });
  assert.equal(ga.forgetAccount(link, []).ok, false, 'forget refuses a symlink account');
  assert.equal(ga.removeAccount(link, []).ok, false, 'remove refuses a symlink account');
  assert.ok(fs.existsSync(real), 'the symlink target survives');
  fs.rmSync(link, { force: true }); fs.rmSync(real, { recursive: true, force: true });
});

test('listLive: one bad row cannot sink the others -- it falls back to UNKNOWN', async () => {
  clean();
  const a = ga.dirForLabel('a'); ga.storeKey(a.dir, 'xai-a-aaaa');
  const b = ga.dirForLabel('b'); ga.storeKey(b.dir, 'xai-b-bbbb');
  let n = 0;
  ga.setFetcher(async () => { n += 1; if (n === 1) throw new Error('boom'); return { status: 200, body: {} }; });
  const rows = await ga.listLive();
  assert.equal(rows.length, 2);
  for (const r of rows) assert.ok([ga.STATE.CONNECTED, ga.STATE.UNKNOWN].includes(r.connection.state), 'never a false NONE from a thrown check');
});
