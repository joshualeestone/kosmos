'use strict';

/**
 * #6609 phase 2b: with a recovery key pinned, the installer's own checks (setup.sh update_manifest_ok early/pre and
 * update_tmux_ok, run by the INSTALLED copy's verifier) use the release key list, not the built-in keys. The installer
 * fetches the list beside the manifest only when that copy asks for it (keylist capability, needs-key-list).
 *
 * The real functions are lifted out of setup.sh and run under /bin/sh against an installed copy whose KEYS and
 * RECOVERY_KEYS are rewritten to throwaway keys (the install.tmux-sig-6473.test.js pattern).
 *
 *   node --test install.recoverykey-setup-6609.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const { KEY_LIST_STATE, KEY_LIST_TYPE } = require('./engine/manifest-verify.js');
const SETUP = fs.readFileSync(path.join(__dirname, 'install', 'setup.sh'), 'utf8');
const VERIFIER = fs.readFileSync(path.join(__dirname, 'engine', 'manifest-verify.js'), 'utf8');
function fnSource(name) {
  const at = SETUP.indexOf('\n' + name + '() {\n');
  assert.notEqual(at, -1, name + ' is gone from install/setup.sh');
  return SETUP.slice(at + 1, SETUP.indexOf('\n}\n', at) + 3);
}
const pair = () => { const k = crypto.generateKeyPairSync('ed25519'); return { priv: k.privateKey, pub: k.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') }; };
const RELEASE = pair();
const OTHER = pair();       // built into the installed copy, dropped by the list (the revoked key)
const RECOVERY = pair();
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

let tmp;
test.before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-rk-setup-6609-')); });
test.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function host(version, { by = RELEASE, list = { seq: 1, keys: [RELEASE.pub] }, listBy = RECOVERY } = {}) {
  const dir = fs.mkdtempSync(path.join(tmp, 'rel-'));
  const tmux = path.join(dir, 'tmux.tar.gz'); fs.writeFileSync(tmux, 'tmux bytes ' + version);
  const tgz = path.join(dir, 'kosmos.tar.gz'); fs.writeFileSync(tgz, 'kosmos bytes ' + version);
  const mp = path.join(dir, `kosmos-${version}-arm64.manifest.json`);
  fs.writeFileSync(mp, JSON.stringify({ manifest: 1, version, arch: 'arm64', sha256: sha(fs.readFileSync(tgz)), tmux_sha256: sha(fs.readFileSync(tmux)), files: [{ path: 'VERSION', sha256: sha(Buffer.from('v ' + version + '\n')) }] }) + '\n');
  fs.writeFileSync(mp + '.sig', crypto.sign(null, fs.readFileSync(mp), by.priv).toString('base64') + '\n');
  if (list) {
    const lp = path.join(dir, 'release-keys.json');
    fs.writeFileSync(lp, JSON.stringify({ type: KEY_LIST_TYPE, seq: list.seq, release_keys: list.keys }) + '\n');
    fs.writeFileSync(lp + '.sig', crypto.sign(null, fs.readFileSync(lp), listBy.priv).toString('base64') + '\n');
  }
  return { dir, tmux, tgz };
}
function installedHome(version, { on = true } = {}) {
  const home = fs.mkdtempSync(path.join(tmp, 'home-'));
  fs.mkdirSync(path.join(home, 'app', 'engine'), { recursive: true });
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  let v = VERIFIER.replace(/const KEYS = \[[\s\S]*?\];/, `const KEYS = ${JSON.stringify([RELEASE.pub, OTHER.pub])};`);
  assert.notEqual(v, VERIFIER, 'the KEYS list moved; this fixture cannot pin its key');
  if (on) {
    const was = v;
    v = v.replace('const RECOVERY_KEYS = Object.freeze([]);', `const RECOVERY_KEYS = Object.freeze([${JSON.stringify(RECOVERY.pub)}]);`);
    assert.notEqual(v, was, 'the RECOVERY_KEYS line moved; this fixture cannot turn the check on');
  }
  fs.writeFileSync(path.join(home, 'app', 'engine', 'manifest-verify.js'), v);
  fs.writeFileSync(path.join(home, 'app', 'package.json'), JSON.stringify({ version }) + '\n');
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  return home;
}
/** early, tmux, then pre against a stage holding the release's kosmos tarball, with the real setup.sh functions. */
function install(r, home, target) {
  const stage = fs.mkdtempSync(path.join(tmp, 'stage-'));
  fs.copyFileSync(r.tgz, path.join(stage, 'kosmos.tar.gz'));
  fs.writeFileSync(path.join(stage, 'VERSION'), 'v ' + target + '\n');   // what post holds the unpacked tree to
  const body = [
    'update_manifest_ok early "" "$2" || { echo "refused at early"; exit 1; }',
    'update_tmux_ok "$1" "$2" || { echo "refused at tmux"; exit 1; }',
    `update_manifest_ok pre "${stage}" "$2" || { echo "refused at pre"; exit 1; }`,
    `update_manifest_ok post "${stage}" "$2" || { echo "refused at post"; exit 1; }`,
    'echo "all-ok"'].join('\n');
  const script = ['set -eu', 'info() { printf "%s\\n" "$*"; }', '_UM_DIR=""', '_UM_NOKEY=""', '_UM_SAID=""',
    fnSource('update_manifest_ok'), fnSource('update_tmux_ok'), body].join('\n');
  const env = { ...process.env, KOSMOS_RELEASE_BASE: 'file://' + r.dir, ARCH: 'arm64', TARGET_VERSION: target, TMPDIR: tmp, KOSMOS_HOME: home };
  delete env.KOSMOS_KEY_LIST; delete env.KOSMOS_KEY_LIST_SIG;
  const p = spawnSync('/bin/sh', ['-c', script, 'sh', r.tmux, home], { encoding: 'utf8', env });
  return { code: p.status, out: p.stdout + p.stderr };
}
const recorded = (h) => { try { return fs.readdirSync(path.join(h, KEY_LIST_STATE)).filter((f) => /^seq-/.test(f)).sort(); } catch { return []; } };
const cli = (home, args, env = {}) => spawnSync(process.execPath, [path.join(home, 'app', 'engine', 'manifest-verify.js'), ...args], { encoding: 'utf8', env: { ...process.env, KOSMOS_KEY_LIST: '', KOSMOS_KEY_LIST_SIG: '', ...env } });

test('on: the installer fetches the list, and early, tmux, pre and post all pass with its keys; the list is recorded', () => {
  const h = installedHome('1.2.0');
  const r = install(host('1.2.3'), h, '1.2.3');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /all-ok/);
  assert.deepEqual(recorded(h), ['seq-1.json']);
});

test('on: THE ATTACK review 1 named: a release signed by a built-in key the list dropped is refused at early', () => {
  const r = install(host('1.2.3', { by: OTHER }), installedHome('1.2.0'), '1.2.3');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /refused at early/);
  const off = install(host('1.2.3', { by: OTHER }), installedHome('1.2.0', { on: false }), '1.2.3');
  assert.equal(off.code, 0, 'CONTROL: off, the built-in key still installs it: ' + off.out);
});

test('on: no list served stops the update before anything is fetched or unpacked', () => {
  const r = install(host('1.2.3', { list: null }), installedHome('1.2.0'), '1.2.3');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /the release key list could not be downloaded, so the update was not installed/);
  assert.match(r.out, /refused at early/);
});

test('on: a list from another signer, and an older list than this copy took, are refused', () => {
  assert.match(install(host('1.2.3', { listBy: OTHER }), installedHome('1.2.0'), '1.2.3').out, /not signed by the Kosmos recovery key \(it may be mid-publish; try again in a minute\), so it was not installed/);
  const h = installedHome('1.2.0');
  assert.equal(install(host('1.2.3', { list: { seq: 2, keys: [RELEASE.pub] } }), h, '1.2.3').code, 0);
  const older = install(host('1.2.4', { list: { seq: 1, keys: [RELEASE.pub, OTHER.pub] } }), h, '1.2.4');
  assert.equal(older.code, 1, older.out);
  assert.match(older.out, /older than the 2 this copy has taken/);
});

test('on: the installed copy refuses when no list is handed to it (an installer that does not fetch it)', () => {
  const r = host('1.2.3');
  const h = installedHome('1.2.0');
  const m = path.join(r.dir, 'kosmos-1.2.3-arm64.manifest.json');
  const plain = cli(h, [m, m + '.sig', '-', '-', '1.2.3', h]);
  assert.equal(plain.status, 1, plain.stdout);
  assert.match(plain.stdout, /the release key list was not given/);
  const tm = cli(h, ['tmux', m, m + '.sig', r.tmux, '1.2.3', h]);
  assert.equal(tm.status, 1, tm.stdout);
  const given = cli(h, [m, m + '.sig', '-', '-', '1.2.3', h], { KOSMOS_KEY_LIST: path.join(r.dir, 'release-keys.json'), KOSMOS_KEY_LIST_SIG: path.join(r.dir, 'release-keys.json.sig') });
  assert.equal(given.status, 0, 'CONTROL: with the list it passes: ' + given.stdout);
});

test('off (as shipped): needs-key-list says no, the installer fetches no list, and a bad or missing one changes nothing', () => {
  const offHome = installedHome('1.2.0', { on: false });
  assert.equal(cli(offHome, ['needs-key-list']).status, 1);
  assert.equal(cli(installedHome('1.2.0'), ['needs-key-list']).status, 0, 'CONTROL: on, it says yes');
  for (const r of [host('1.2.3', { list: null }), host('1.2.3', { listBy: OTHER })]) {
    const h = installedHome('1.2.0', { on: false });
    const out = install(r, h, '1.2.3');
    assert.equal(out.code, 0, out.out);
    assert.deepEqual(recorded(h), [], 'off writes no record');
  }
  assert.match(VERIFIER, /capabilities: run-setup early tmux keylist( [a-z0-9-]+)* \*\//, 'the installer finds the capability');
});
