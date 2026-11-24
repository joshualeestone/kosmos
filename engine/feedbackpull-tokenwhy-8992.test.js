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

test('filed and read: the token, and the map is asked nothing more', () => {
  const asked = map({ value: ok('vercel_blob_rw_x\n') });
  assert.deepEqual(fp.tokenReading(), { token: 'vercel_blob_rw_x' });
  assert.deepEqual(asked, ['value']);
});

test('a read that TIMED OUT on a filed target says run again, never file it', async () => {
  map({ value: { status: null, stdout: '', stderr: '', error: TIMEOUT }, lookup: ok('target ' + T + '\n') });
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
  map({ value: { status: null, stdout: 'vercel_blob_rw_part', stderr: '', error: TIMEOUT }, lookup: ok('cred:     /x/a\n') });
  assert.deepEqual(fp.tokenReading(), { why: 'unread' });
  map({ value: { status: 1, stdout: 'vercel_blob_rw_part', stderr: '' }, lookup: ok('cred:     /x/a\n') });
  assert.deepEqual(fp.tokenReading(), { why: 'unread' }, 'nor a part printed before a failing exit');
});

test('review 1: filed but the map will not read it as filed (BLOCKED, or two credentials): fix the filing, not run again', async () => {
  map({ value: { status: 1, stdout: '', stderr: 'secrets-map: refused\n' }, lookup: ok('cred:     /x/a\nformat:   bare-token   ** MISMATCH - the file looks like: sourceable-env **\nconsume:  BLOCKED until the mismatch above is resolved\n') });
  assert.deepEqual(fp.tokenReading(), { why: 'misfiled' });
  map({ value: { status: 1, stdout: '', stderr: '' }, lookup: ok('cred:     /x/a\ncred:     /x/b\n') });
  assert.deepEqual(fp.tokenReading(), { why: 'misfiled' }, 'two credentials for one target');
  const r = await fp.pull(path.join(SB, 'd5'));
  assert.equal(r.why, 'misfiled');
  assert.match(r.because, /will not read it as filed/);
  assert.match(r.because, /Fix the filing with \/add-secret; running the pull again will not help/);
});

test('review 1: no credential folder at all is missing (file it), as the tool itself says', () => {
  const NODIR = 'secrets-map: no credential dir at /x/.config/secrets - add one via /add-secret.\n';
  map({ value: { status: 1, stdout: '', stderr: NODIR }, lookup: { status: 1, stdout: '', stderr: NODIR } });
  assert.deepEqual(fp.tokenReading(), { why: 'missing' });
});

test('review 1: a first copy that cannot be run, or does not know the verb, lets the second place answer', () => {
  const EACCES = Object.assign(new Error('spawnSync secrets-map.sh EACCES'), { code: 'EACCES' });
  for (const first of [{ error: EACCES }, { status: 2, stdout: '', stderr: 'usage: secrets-map.sh ...\n' }]) {
    fp.setSecretsRunner((bin, args) => (bin === 'secrets-map.sh' ? first : (args[0] === 'value' ? ok('tok2') : ok(''))));
    assert.deepEqual(fp.tokenReading(), { token: 'tok2' }, JSON.stringify(first));
    fp.setSecretsRunner((bin) => (bin === 'secrets-map.sh' ? first : { error: ENOENT }));
    assert.deepEqual(fp.tokenReading(), { why: 'unsure' }, 'and with no second place: unsure, not "no tool"');
  }
  // A timeout answers at the first place (the wait stays one read and one lookup).
  const asked = [];
  fp.setSecretsRunner((bin, args) => { asked.push(bin === 'secrets-map.sh' ? 'first ' + args[0] : 'second ' + args[0]); return args[0] === 'value' ? { error: TIMEOUT } : ok('cred:     /x/a\n'); });
  assert.deepEqual(fp.tokenReading(), { why: 'unread' });
  assert.deepEqual(asked, ['first value', 'first lookup']);
});

test('a read that failed some other way (exit 1, not "no credential") on a filed target: run again', () => {
  map({ value: { status: 1, stdout: '', stderr: 'refusing: stdout is a tty\n' }, lookup: ok('x') });
  assert.deepEqual(fp.tokenReading(), { why: 'unread' });
  map({ value: ok('   \n'), lookup: ok('x') });
  assert.deepEqual(fp.tokenReading(), { why: 'unread' }, 'an empty value at exit 0 is not a token');
});

test('a target the map does not have says not filed (the old message, still right here)', async () => {
  map({ value: { status: 1, stdout: '', stderr: MISSING }, lookup: { status: 1, stdout: '', stderr: MISSING } });
  assert.deepEqual(fp.tokenReading(), { why: 'missing' });
  const r = await fp.pull(path.join(SB, 'd2'));
  assert.equal(r.why, 'missing');
  assert.match(r.because, /token is not filed yet/);
  assert.match(r.because, /File it with \/add-secret/);
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
  assert.deepEqual(fp.tokenReading(), { why: 'unsure' });
});

test('the real secrets-map.sh, its secrets folder pointed at an empty and at an absent folder: tokenReading says missing', (t) => {
  const real = path.join(os.homedir(), '.local', 'bin', 'secrets-map.sh');
  if (!fs.existsSync(real)) { t.skip('no secrets-map.sh on this computer'); return; }
  // Measured 2026-11-24: lookup exits 1 saying "no credential mapped" (an empty folder) or "no credential dir at" (none).
  // Driven through the real tool, so a change to its wording is seen here, not as every agent being told to re-file.
  const was = process.env.SECRETS_DIR;
  const empty = fs.mkdtempSync(path.join(SB, 'secrets-'));
  try {
    process.env.SECRETS_DIR = empty;
    assert.deepEqual(fp.tokenReading(), { why: 'missing' }, 'an empty secrets folder');
    process.env.SECRETS_DIR = path.join(SB, 'no-such-secrets-folder');
    assert.deepEqual(fp.tokenReading(), { why: 'missing' }, 'no secrets folder');
    assert.equal(fs.existsSync(path.join(SB, 'no-such-secrets-folder')), false, 'and the tool did not make one');
  } finally {
    if (was === undefined) delete process.env.SECRETS_DIR; else process.env.SECRETS_DIR = was;
  }
});
