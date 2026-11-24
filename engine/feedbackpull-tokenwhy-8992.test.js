'use strict';
/* kosmos#8992: `kosmos feedback pull` told an agent to file the collected-feedback token again when reading it merely
   failed or timed out. Now the pull asks the secrets map why and names the one next step that can help: file it (only
   when the map has no such target), run again, fix the filing or the file's mode, fix the folder's unreadable files, or
   fix the tool. The secrets map is an injected runner shaped like spawnSync, so nothing touches the real map; every
   folder these tests look at is a temp one (SECRETS_DIR), never the real one. Two tests drive the real secrets-map.sh
   against fake credentials in a temp folder. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'feedbackpull-why-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
// No test reads the real secrets folder: the default here is a folder that does not exist (nothing filed, all readable).
const NO_FOLDER = path.join(SB, 'no-secrets-folder');
process.env.SECRETS_DIR = NO_FOLDER;
const fp = require('./feedbackpull');

test.afterEach(() => { fp.setSecretsRunner(null); fp.setTransport(null); process.env.SECRETS_DIR = NO_FOLDER; });
test.after(() => { fs.rmSync(SB, { recursive: true, force: true }); });

const T = fp.FEEDBACK_TOKEN_TARGET;
const MISSING = `secrets-map: no credential mapped to target '${T}' in /x/.config/secrets.\n`;
const TIMEOUT = Object.assign(new Error('spawnSync secrets-map.sh ETIMEDOUT'), { code: 'ETIMEDOUT' });
const ENOENT = Object.assign(new Error('spawnSync secrets-map.sh ENOENT'), { code: 'ENOENT' });
const EPERM = Object.assign(new Error('spawnSync secrets-map.sh EPERM'), { code: 'EPERM' });
const OLD = { status: 2, stdout: '', stderr: "secrets-map.sh: unknown subcommand 'value' (try --help)\n" };
const ok = (stdout) => ({ status: 0, stdout, stderr: '' });
// What the real lookup prints for one bare-token credential (secrets-map.sh lookup, measured 2026-11-24).
const FILED = `cred:     /x/.config/secrets/blob\nidentity: feedback store\nformat:   bare-token\nconsume:  secrets-map.sh value ${T}\n`;
// A runner answering `value` and `lookup` as given, recording what was asked.
function map({ value, lookup }) {
  const asked = [];
  fp.setSecretsRunner((bin, args) => { asked.push(args[0]); return args[0] === 'value' ? value : lookup; });
  return asked;
}
const why = () => { const r = fp.tokenReading(); assert.ok(!('token' in r), 'no token expected here'); return r.why + (r.detail ? ':' + r.detail : ''); };
const pullSays = async (dir) => fp.pull(path.join(SB, dir));

test('filed and read: the token, and the map is asked nothing more', () => {
  const asked = map({ value: ok('vercel_blob_rw_x\n') });
  assert.deepEqual(fp.tokenReading(), { token: 'vercel_blob_rw_x' });
  assert.deepEqual(asked, ['value']);
});

test('the token the map gives is the one the pull sends', async () => {
  map({ value: ok('vercel_blob_rw_from_map\n') });
  const sent = [];
  fp.setTransport({ list: async (tok) => { sent.push(tok); return []; }, get: async () => '' });
  const r = await pullSays('send');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(sent, ['vercel_blob_rw_from_map']);
});

test('retry: a read that timed out or failed on a filed target, or a map that did not answer, says run again, never file it', async () => {
  for (const [value, lookup, what] of [
    [{ status: null, stdout: '', stderr: '', error: TIMEOUT }, ok(FILED), 'timed out'],
    [{ status: 1, stdout: '', stderr: 'refusing: stdout is a tty\n' }, ok(FILED), 'failed'],
    [ok('   \n'), ok(FILED), 'an empty value at exit 0 is not a token'],
    [{ status: null, stdout: 'vercel_blob_rw_part', error: TIMEOUT }, ok(FILED), 'a part printed before a timeout is never used'],
    [{ status: 1, stdout: 'vercel_blob_rw_part' }, ok(FILED), 'nor a part printed before a failing exit'],
    [{ error: TIMEOUT }, { error: TIMEOUT }, 'the lookup timed out too'],
    [{ status: 1 }, { status: 2, stderr: 'secrets-map: something else\n' }, 'the lookup said something else'],
    [{ status: 1 }, { status: 1, stderr: 'some other failure\n' }, 'exit 1 alone is not proof of missing'],
    [{ status: 1, stderr: MISSING }, { status: 2, stderr: MISSING }, 'the missing wording with another exit is not proof either'],
  ]) {
    map({ value, lookup });
    assert.equal(why(), 'retry', what);
  }
  fp.setTransport({ list: async () => { throw new Error('must not list without a token'); }, get: async () => '' });
  map({ value: { error: TIMEOUT }, lookup: ok(FILED) });
  const r = await pullSays('retry');
  assert.equal(r.ok, false);
  assert.equal(r.why, 'retry');
  assert.match(r.because, /could not be read just now/);
  assert.match(r.because, /Run the pull again; do not file it/);
  assert.match(r.because, /file it only if that says it is missing/);
  assert.doesNotMatch(r.because, /not filed yet|File it with/);
});

test('missing: a target the map does not have, or no secrets folder, says file it (the old message, still right here)', async () => {
  const NODIR = 'secrets-map: no credential dir at /x/.config/secrets - add one via /add-secret.\n';
  for (const said of [MISSING, NODIR]) {
    map({ value: { status: 1, stdout: '', stderr: said }, lookup: { status: 1, stdout: '', stderr: said } });
    assert.equal(why(), 'missing', said);
  }
  const r = await pullSays('missing');
  assert.equal(r.why, 'missing');
  assert.match(r.because, /token is not filed yet/);
  assert.match(r.because, /File it with \/add-secret/);
  assert.match(r.because, /run `secrets-map.sh audit` first/, 'a credential whose header cannot be read looks unfiled');
});

test('misfiled: filed in a way value refuses every time (incl. a file this user cannot read) says fix it, never run again', async () => {
  const one = (consume, more = '') => `cred:     /x/a\n${more}consume:  ${consume}\n`;
  for (const report of [
    one('BLOCKED until the mismatch above is resolved', 'format:   bare-token   ** MISMATCH - the file looks like: sourceable-env **\n'),
    one('BLOCKED - nothing can read this file as the current user.', 'format:   bare-token   ** FILE NOT READABLE - check its mode/owner **\n'),
    one(`secrets-map.sh path ${T}   (consumed by PATH - never by value)`),
    one('shape undeterminable - inspect the file before using it'),
    one(`eval "$(secrets-map.sh env ${T})"  (or: value ${T} <VAR>)`),
    one(`secrets-map.sh value ${T}X`),
    FILED + FILED,
  ]) {
    map({ value: { status: 1, stdout: '', stderr: '' }, lookup: ok(report) });
    assert.equal(why(), 'misfiled', report);
  }
  const REFUSED = { status: 2, stdout: '', stderr: `secrets-map: '${T}' is a sourceable-env credential - it holds NAMED values,\n` };
  map({ value: REFUSED, lookup: ok(`cred:     /x/a\nconsume:  eval "$(secrets-map.sh env ${T})"  (or: value ${T} <VAR>)\n`) });
  assert.equal(why(), 'misfiled', 'an exit 2 that is not an unknown verb is the verb refusing a shape, never "update the tool"');
  const r = await pullSays('misfiled');
  assert.match(r.because, /cannot give it as filed/);
  assert.match(r.because, /Fix the file's mode or owner, or the filing with \/add-secret; running the pull again will not help/);
});

test('unreadable: "no credential mapped" but a file in the folder cannot be read: name audit and the modes, never file it', async (t) => {
  const dir = path.join(SB, 'locked-secrets');
  fs.mkdirSync(dir, { mode: 0o700 });
  const f = path.join(dir, 'blob');
  fs.writeFileSync(f, '# secret-map: fake\n', { mode: 0o600 });
  fs.chmodSync(f, 0o000);
  try {
    let readable = true;
    try { fs.accessSync(f, fs.constants.R_OK); } catch { readable = false; }
    if (readable) { t.skip('running as a user that reads any file (root): nothing to show here'); return; }
    process.env.SECRETS_DIR = dir;
    map({ value: { status: 1, stdout: '', stderr: MISSING }, lookup: { status: 1, stdout: '', stderr: MISSING } });
    assert.equal(why(), 'unreadable');
    const r = await pullSays('unreadable');
    assert.match(r.because, /`secrets-map.sh audit` lists the files it cannot read: fix their mode or owner/);
    assert.doesNotMatch(r.because, /File it with|file it again/);
  } finally { fs.chmodSync(f, 0o600); }
});

test('the readable check skips what the tool skips: a dangling link, its README, a backup, a dotfile, a folder', () => {
  const dir = path.join(SB, 'odd-secrets');
  fs.mkdirSync(dir, { mode: 0o700 });
  fs.symlinkSync(path.join(SB, 'gone-target'), path.join(dir, 'old.key'));
  fs.mkdirSync(path.join(dir, 'sub'), { mode: 0o000 });
  for (const n of ['README.md', 'x.bak', '.hidden']) { fs.writeFileSync(path.join(dir, n), 'x'); fs.chmodSync(path.join(dir, n), 0o000); }
  try {
    process.env.SECRETS_DIR = dir;
    map({ value: { status: 1, stdout: '', stderr: MISSING }, lookup: { status: 1, stdout: '', stderr: MISSING } });
    assert.equal(why(), 'missing', 'none of those is a credential, so a missing token is still told to be filed');
  } finally { fs.chmodSync(path.join(dir, 'sub'), 0o700); }
});

test('tool: not found at any place, an old copy, or one that cannot start, each says how to fix the tool, never file it', async () => {
  const asked = [];
  fp.setSecretsRunner((bin, args) => { asked.push(bin + ' ' + args[0]); return { error: ENOENT }; });
  assert.equal(why(), 'tool:not-found');
  assert.equal(asked.length, 3, 'PATH, ~/.local/bin and ~/.claude/scripts were tried: ' + asked.join(', '));
  assert.ok(asked.some((a) => a.includes(path.join('.claude', 'scripts', 'secrets-map.sh'))), 'the fleet copy is one of them');
  let r = await pullSays('tool1');
  assert.match(r.because, /was not found \(on PATH, in ~\/.local\/bin or in ~\/.claude\/scripts\)/);
  assert.match(r.because, /Install or update it with \/agent-refresh/);
  fp.setSecretsRunner(() => OLD);
  assert.equal(why(), 'tool:old');
  r = await pullSays('tool2');
  assert.match(r.because, /is an old copy without `value`/);
  fp.setSecretsRunner(() => ({ error: EPERM }));
  assert.equal(why(), 'tool:cannot-start');
  r = await pullSays('tool3');
  assert.match(r.because, /could not be started here/);
  assert.match(r.because, /Run the pull where it can run/);
  for (const m of [r.because]) assert.doesNotMatch(m, /File it with|not filed yet/);
  fp.setSecretsRunner(() => { throw new Error('boom'); });
  assert.equal(why(), 'tool:cannot-start', 'a runner that throws is a copy that could not start, never a crash');
});

test('a place that cannot answer lets the next one; a timeout answers where it is (a bounded wait)', () => {
  const EACCES = Object.assign(new Error('spawnSync secrets-map.sh EACCES'), { code: 'EACCES' });
  for (const first of [{ error: EACCES }, OLD, { error: ENOENT }]) {
    fp.setSecretsRunner((bin, args) => (bin === 'secrets-map.sh' ? first : (args[0] === 'value' ? ok('tok2') : ok(''))));
    assert.deepEqual(fp.tokenReading(), { token: 'tok2' }, JSON.stringify(first));
  }
  fp.setSecretsRunner((bin, args) => (bin.includes(path.join('.claude', 'scripts')) ? (args[0] === 'value' ? ok('tok3') : ok('')) : { error: ENOENT }));
  assert.deepEqual(fp.tokenReading(), { token: 'tok3' }, 'only the fleet copy: still read');
  const asked = [];
  fp.setSecretsRunner((bin, args) => { asked.push(bin === 'secrets-map.sh' ? 'first ' + args[0] : 'other ' + args[0]); return args[0] === 'value' ? { error: TIMEOUT } : ok(FILED); });
  assert.equal(why(), 'retry');
  assert.deepEqual(asked, ['first value', 'first lookup']);
});

test('the real secrets-map.sh, its secrets folder pointed at an empty and at an absent folder: missing', (t) => {
  const real = path.join(os.homedir(), '.local', 'bin', 'secrets-map.sh');
  if (!fs.existsSync(real)) { t.skip('no secrets-map.sh on this computer'); return; }
  // Measured 2026-11-24: lookup exits 1 saying "no credential mapped" (an empty folder) or "no credential dir at" (none).
  // Driven through the real tool, so a change to its wording is seen here, not as every agent being told to re-file.
  const wasPath = process.env.PATH;
  try {
    // The tool's own folder first, so the copy tokenReading finds on PATH is the one this test checked for.
    process.env.PATH = path.dirname(real) + path.delimiter + (wasPath || '');
    process.env.SECRETS_DIR = fs.mkdtempSync(path.join(SB, 'secrets-'));
    // Never let a token reach an assertion message: only whether one came back is asserted, then the why.
    assert.equal(why(), 'missing', 'an empty secrets folder');
    process.env.SECRETS_DIR = path.join(SB, 'no-such-secrets-folder');
    assert.equal(why(), 'missing', 'no secrets folder');
    assert.equal(fs.existsSync(path.join(SB, 'no-such-secrets-folder')), false, 'and the tool did not make one');
  } finally { process.env.PATH = wasPath; }
});

test('the real secrets-map.sh with FAKE credentials in a temp folder: a bare token is read, an env-shaped one is misfiled', (t) => {
  const real = path.join(os.homedir(), '.local', 'bin', 'secrets-map.sh');
  if (!fs.existsSync(real)) { t.skip('no secrets-map.sh on this computer'); return; }
  // Measured 2026-11-24: `value` exits 2 refusing an env-shaped credential, the same code an old copy gives for an
  // unknown verb; only the wording tells them apart. Fake values only, in a folder this test made.
  const wasPath = process.env.PATH;
  const write = (dir, body) => { fs.mkdirSync(dir, { mode: 0o700 }); fs.writeFileSync(path.join(dir, 'blob'), body, { mode: 0o600 }); return dir; };
  const head = `# secret-map: fake test credential\n# targets: ${T}\n`;
  try {
    process.env.PATH = path.dirname(real) + path.delimiter + (wasPath || '');
    process.env.SECRETS_DIR = write(path.join(SB, 'fake-bare'), head + '# format: bare-token\nfake_blob_token_8992\n');
    const bare = fp.tokenReading();
    assert.ok(bare.token === 'fake_blob_token_8992', 'CONTROL: the fake token was not the one read');   // never echoes what was read
    process.env.SECRETS_DIR = write(path.join(SB, 'fake-env'), head + '# format: sourceable-env\nFAKE_A=one\nFAKE_B=two\n');
    assert.equal(why(), 'misfiled');
  } finally { process.env.PATH = wasPath; }
});
