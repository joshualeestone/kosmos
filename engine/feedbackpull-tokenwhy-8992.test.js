'use strict';
/* kosmos#8992: `kosmos feedback pull` told an agent to file the collected-feedback token again when reading it merely
   failed or timed out. Now the pull asks the secrets map why: only a target the map does not have says "not filed";
   a read that failed or timed out says to run it again; a filing the map refuses says to fix the filing. The secrets map
   is an injected runner shaped like spawnSync, so nothing touches the real map; the last test drives tokenReading through
   the real secrets-map.sh with SECRETS_DIR pointed at an empty or absent folder (never the real one). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'feedbackpull-why-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
const fp = require('./feedbackpull');

test.afterEach(() => { fp.setSecretsRunner(null); fp.setTransport(null); });
test.after(() => { fs.rmSync(SB, { recursive: true, force: true }); });

const T = fp.FEEDBACK_TOKEN_TARGET;
const MISSING = `secrets-map: no credential mapped to target '${T}' in /x/.config/secrets.\n`;
const TIMEOUT = Object.assign(new Error('spawnSync secrets-map.sh ETIMEDOUT'), { code: 'ETIMEDOUT' });
const ENOENT = Object.assign(new Error('spawnSync secrets-map.sh ENOENT'), { code: 'ENOENT' });
// A runner answering `value` and `lookup` as given, recording what was asked.
function map({ value, lookup }) {
  const asked = [];
  fp.setSecretsRunner((bin, args) => { asked.push(args[0]); return args[0] === 'value' ? value : lookup; });
  return asked;
}
const ok = (stdout) => ({ status: 0, stdout, stderr: '' });
// What the real lookup prints for one bare-token credential (secrets-map.sh lookup, measured 2026-11-24).
const FILED = `cred:     /x/.config/secrets/blob\nidentity: feedback store\nformat:   bare-token\nconsume:  secrets-map.sh value ${T}\n`;

test('filed and read: the token, and the map is asked nothing more', () => {
  const asked = map({ value: ok('vercel_blob_rw_x\n') });
  assert.deepEqual(fp.tokenReading(), { token: 'vercel_blob_rw_x' });
  assert.deepEqual(asked, ['value']);
});

test('a read that TIMED OUT on a filed target says run again, never file it', async () => {
  map({ value: { status: null, stdout: '', stderr: '', error: TIMEOUT }, lookup: ok(FILED) });
  assert.deepEqual(fp.tokenReading(), { why: 'unread' });
  fp.setTransport({ list: async () => { throw new Error('must not list without a token'); }, get: async () => '' });
  const r = await fp.pull(path.join(SB, 'd1'));
  assert.equal(r.ok, false);
  assert.equal(r.why, 'unread');
  assert.match(r.because, /reading it failed or timed out/);
  assert.match(r.because, /Run the pull again; do not file it again\. If it fails again, `secrets-map.sh lookup vercel-blob-feedback` says why/);
  assert.doesNotMatch(r.because, /not filed|File it with/);
});

test('a read that timed out after printing part of the token never uses the part', () => {
  map({ value: { status: null, stdout: 'vercel_blob_rw_part', stderr: '', error: TIMEOUT }, lookup: ok(FILED) });
  assert.deepEqual(fp.tokenReading(), { why: 'unread' });
  map({ value: { status: 1, stdout: 'vercel_blob_rw_part', stderr: '' }, lookup: ok(FILED) });
  assert.deepEqual(fp.tokenReading(), { why: 'unread' }, 'nor a part printed before a failing exit');
});

test('review 1: filed but the map will not read it as filed (BLOCKED, or two credentials): fix the filing, not run again', async () => {
  map({ value: { status: 1, stdout: '', stderr: 'secrets-map: refused\n' }, lookup: ok('cred:     /x/a\nformat:   bare-token   ** MISMATCH - the file looks like: sourceable-env **\nconsume:  BLOCKED until the mismatch above is resolved\n') });
  assert.deepEqual(fp.tokenReading(), { why: 'misfiled' });
  map({ value: { status: 1, stdout: '', stderr: '' }, lookup: ok(FILED + FILED) });
  assert.deepEqual(fp.tokenReading(), { why: 'misfiled' }, 'two credentials for one target');
  // Review 2: shapes `value` refuses every time, though lookup shows no BLOCKED (secrets-map.sh lookup's other lines).
  for (const consume of [`secrets-map.sh path ${T}   (consumed by PATH - never by value)`, 'shape undeterminable - inspect the file before using it',
    `eval "$(secrets-map.sh env ${T})"  (or: value ${T} <VAR>)`, `secrets-map.sh value ${T}X`]) {
    map({ value: { status: 1, stdout: '', stderr: '' }, lookup: ok(`cred:     /x/a\nconsume:  ${consume}\n`) });
    assert.deepEqual(fp.tokenReading(), { why: 'misfiled' }, consume);
  }
  const r = await fp.pull(path.join(SB, 'd5'));
  assert.equal(r.why, 'misfiled');
  assert.match(r.because, /will not read it as filed/);
  assert.match(r.because, /Fix the filing with \/add-secret, or the file's mode if it says not readable; running the pull again will not help/);
});

test('review 1: no credential folder at all is missing (file it), as the tool itself says', () => {
  const NODIR = 'secrets-map: no credential dir at /x/.config/secrets - add one via /add-secret.\n';
  map({ value: { status: 1, stdout: '', stderr: NODIR }, lookup: { status: 1, stdout: '', stderr: NODIR } });
  assert.deepEqual(fp.tokenReading(), { why: 'missing' });
});

test('review 1: a first copy that cannot be run, or does not know the verb, lets the second place answer', () => {
  const EACCES = Object.assign(new Error('spawnSync secrets-map.sh EACCES'), { code: 'EACCES' });
  const OLD = { status: 2, stdout: '', stderr: "secrets-map.sh: unknown subcommand 'value' (try --help)\n" };   // a copy without the verb
  for (const first of [{ error: EACCES }, OLD]) {
    fp.setSecretsRunner((bin, args) => (bin === 'secrets-map.sh' ? first : (args[0] === 'value' ? ok('tok2') : ok(''))));
    assert.deepEqual(fp.tokenReading(), { token: 'tok2' }, JSON.stringify(first));
    fp.setSecretsRunner((bin) => (bin === 'secrets-map.sh' ? first : { error: ENOENT }));
    assert.deepEqual(fp.tokenReading(), { why: 'tool-broken' }, 'and with no second place: the tool is broken, not "no tool" and not "run again"');
  }
  // A timeout answers at the first place (the wait stays one read and one lookup).
  const asked = [];
  fp.setSecretsRunner((bin, args) => { asked.push(bin === 'secrets-map.sh' ? 'first ' + args[0] : 'second ' + args[0]); return args[0] === 'value' ? { error: TIMEOUT } : ok(FILED); });
  assert.deepEqual(fp.tokenReading(), { why: 'unread' });
  assert.deepEqual(asked, ['first value', 'first lookup']);
});

test('a tool that cannot run value says update it, never run again or file it', async () => {
  fp.setSecretsRunner(() => ({ status: 2, stdout: '', stderr: "secrets-map.sh: unknown subcommand 'value' (try --help)\n" }));
  const r = await fp.pull(path.join(SB, 'd6'));
  assert.equal(r.why, 'tool-broken');
  assert.match(r.because, /Update it with \/agent-refresh, then run the pull again; do not file the token again/);
  assert.doesNotMatch(r.because, /File it with/);
});

test('round 4: any other exit 2 is the verb refusing a filed shape, which the lookup names: never "update the tool"', () => {
  const REFUSED = { status: 2, stdout: '', stderr: `secrets-map: '${T}' is a sourceable-env credential - it holds NAMED values,\n` };
  map({ value: REFUSED, lookup: ok(`cred:     /x/a\nformat:   sourceable-env\nconsume:  eval "$(secrets-map.sh env ${T})"  (or: value ${T} <VAR>)\n`) });
  assert.deepEqual(fp.tokenReading(), { why: 'misfiled' });
});

test('the token the map gives is the one the pull sends', async () => {
  map({ value: ok('vercel_blob_rw_from_map\n') });
  const sent = [];
  fp.setTransport({ list: async (tok) => { sent.push(tok); return []; }, get: async () => '' });
  const r = await fp.pull(path.join(SB, 'd7'));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(sent, ['vercel_blob_rw_from_map']);
});

test('a read that failed some other way (exit 1, not "no credential") on a filed target: run again', () => {
  map({ value: { status: 1, stdout: '', stderr: 'refusing: stdout is a tty\n' }, lookup: ok(FILED) });
  assert.deepEqual(fp.tokenReading(), { why: 'unread' });
  map({ value: ok('   \n'), lookup: ok(FILED) });
  assert.deepEqual(fp.tokenReading(), { why: 'unread' }, 'an empty value at exit 0 is not a token');
});

test('a target the map does not have says not filed (the old message, still right here)', async () => {
  map({ value: { status: 1, stdout: '', stderr: MISSING }, lookup: { status: 1, stdout: '', stderr: MISSING } });
  assert.deepEqual(fp.tokenReading(), { why: 'missing' });
  const r = await fp.pull(path.join(SB, 'd2'));
  assert.equal(r.why, 'missing');
  assert.match(r.because, /token is not filed yet/);
  assert.match(r.because, /File it with \/add-secret/);
  assert.match(r.because, /run `secrets-map.sh audit` first/, 'a credential whose header cannot be read looks unfiled');
});

test('the map does not answer the lookup either: run again, file only if a lookup says missing', async () => {
  map({ value: { error: TIMEOUT }, lookup: { error: TIMEOUT } });
  assert.deepEqual(fp.tokenReading(), { why: 'unsure' });
  map({ value: { status: 1, stderr: '' }, lookup: { status: 2, stderr: 'secrets-map: something else\n' } });
  assert.deepEqual(fp.tokenReading(), { why: 'unsure' }, 'a lookup exit that is not the "no credential" one is not proof of missing');
  map({ value: { status: 1, stderr: '' }, lookup: { status: 1, stderr: 'some other failure\n' } });
  assert.deepEqual(fp.tokenReading(), { why: 'unsure' }, 'exit 1 alone is not proof of missing');
  const r = await fp.pull(path.join(SB, 'd3'));
  assert.match(r.because, /could not be read just now/);
  assert.match(r.because, /only if `secrets-map.sh lookup vercel-blob-feedback` says it is missing/);
});

test('no secrets-map.sh at either place: says so, does not say "not filed"', async () => {
  const asked = [];
  fp.setSecretsRunner((bin, args) => { asked.push(bin + ' ' + args[0]); return { error: ENOENT }; });
  assert.deepEqual(fp.tokenReading(), { why: 'no-tool' });
  assert.equal(asked.length, 2, 'both places were tried: ' + asked.join(', '));
  const r = await fp.pull(path.join(SB, 'd4'));
  assert.match(r.because, /secrets-map.sh\) is not on this computer/);
  assert.doesNotMatch(r.because, /not filed/);
});

test('the first place missing, the second answering: the token from the second', () => {
  fp.setSecretsRunner((bin, args) => (bin === 'secrets-map.sh' ? { error: ENOENT } : (args[0] === 'value' ? ok('tok2') : ok(''))));
  assert.deepEqual(fp.tokenReading(), { token: 'tok2' });
});

test('a runner that throws is a failed read, never a crash', () => {
  fp.setSecretsRunner(() => { throw new Error('boom'); });
  assert.deepEqual(fp.tokenReading(), { why: 'tool-broken' }, 'it could not be run at either place');
});

test('the real secrets-map.sh, its secrets folder pointed at an empty and at an absent folder: tokenReading says missing', (t) => {
  const real = path.join(os.homedir(), '.local', 'bin', 'secrets-map.sh');
  if (!fs.existsSync(real)) { t.skip('no secrets-map.sh on this computer'); return; }
  // Measured 2026-11-24: lookup exits 1 saying "no credential mapped" (an empty folder) or "no credential dir at" (none).
  // Driven through the real tool, so a change to its wording is seen here, not as every agent being told to re-file.
  const was = process.env.SECRETS_DIR;
  const wasPath = process.env.PATH;
  const empty = fs.mkdtempSync(path.join(SB, 'secrets-'));
  try {
    // Review 2: the tool's own folder first, so the copy tokenReading finds on PATH is the one this test checked for.
    process.env.PATH = path.dirname(real) + path.delimiter + (wasPath || '');
    /* Never let a token reach an assertion's message: if a copy of the tool ignored SECRETS_DIR and read the real one,
       a deepEqual diff would print it. Only whether a token came back is asserted, then the why. */
    const noToken = (r, what) => { assert.ok(!Object.prototype.hasOwnProperty.call(r, 'token'), what + ': a token was read, so SECRETS_DIR was not honoured'); assert.equal(r.why, 'missing', what); };
    process.env.SECRETS_DIR = empty;
    noToken(fp.tokenReading(), 'an empty secrets folder');
    process.env.SECRETS_DIR = path.join(SB, 'no-such-secrets-folder');
    noToken(fp.tokenReading(), 'no secrets folder');
    assert.equal(fs.existsSync(path.join(SB, 'no-such-secrets-folder')), false, 'and the tool did not make one');
  } finally {
    if (was === undefined) delete process.env.SECRETS_DIR; else process.env.SECRETS_DIR = was;
    process.env.PATH = wasPath;
  }
});

test('the real secrets-map.sh with FAKE credentials in a temp folder: a bare token is read, an env-shaped one is misfiled', (t) => {
  const real = path.join(os.homedir(), '.local', 'bin', 'secrets-map.sh');
  if (!fs.existsSync(real)) { t.skip('no secrets-map.sh on this computer'); return; }
  // Measured 2026-11-24 (round 4): `value` exits 2 refusing an env-shaped credential, the same code an old copy gives
  // for an unknown verb; only the wording tells them apart. Fake values only, in a folder this test made.
  const was = process.env.SECRETS_DIR;
  const wasPath = process.env.PATH;
  const write = (dir, body) => { fs.mkdirSync(dir, { mode: 0o700 }); fs.writeFileSync(path.join(dir, 'blob'), body, { mode: 0o600 }); return dir; };
  const head = `# secret-map: fake test credential\n# targets: ${T}\n`;
  try {
    process.env.PATH = path.dirname(real) + path.delimiter + (wasPath || '');
    process.env.SECRETS_DIR = write(path.join(SB, 'fake-bare'), head + '# format: bare-token\nfake_blob_token_8992\n');
    const bare = fp.tokenReading();
    assert.equal(bare.token, 'fake_blob_token_8992', 'CONTROL: a well-filed (fake) token is read');
    process.env.SECRETS_DIR = write(path.join(SB, 'fake-env'), head + '# format: sourceable-env\nFAKE_A=one\nFAKE_B=two\n');
    const env = fp.tokenReading();
    assert.ok(!Object.prototype.hasOwnProperty.call(env, 'token'), 'an env file must not read as a token');
    assert.equal(env.why, 'misfiled');
  } finally {
    if (was === undefined) delete process.env.SECRETS_DIR; else process.env.SECRETS_DIR = was;
    process.env.PATH = wasPath;
  }
});
