'use strict';

/**
 * #6468 ask 2: a downloaded update must match its SIGNED release manifest, checked by the INSTALLED copy.
 *
 * Part 1 drives engine/manifest-verify.js's verify() with a throwaway ed25519 key passed as the pinned list.
 * Part 2 runs install/setup.sh's real update_manifest_ok under /bin/sh against a fake installed home whose verifier is
 * this repo's, with its pinned key list rewritten to the throwaway key (standing in for "the installed copy pins K"),
 * and a file:// release base serving the manifest and its .sig.
 *
 *   node --test install.manifest-sig-6468.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const { verify, KEYS } = require('./engine/manifest-verify.js');
const SETUP = fs.readFileSync(path.join(__dirname, 'install', 'setup.sh'), 'utf8');
const VERIFIER = fs.readFileSync(path.join(__dirname, 'engine', 'manifest-verify.js'), 'utf8');
function fnSource(name) {
  const at = SETUP.indexOf('\n' + name + '() {\n');
  assert.notEqual(at, -1, name + ' is gone from install/setup.sh');
  const end = SETUP.indexOf('\n}\n', at);
  return SETUP.slice(at + 1, end + 3);
}

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const other = crypto.generateKeyPairSync('ed25519');

let tmp;
test.before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-mansig-6468-')); });
test.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/** A release: a stage tree, a stand-in tarball, its manifest and .sig (signed with `key`), all in one folder. */
function release(version, { key = privateKey, files = { 'bin/kosmos': '#!/bin/sh\n', 'app/server.js': 'x', 'runtime/bin/node': 'n', VERSION: version + '\n' } } = {}) {
  const dir = fs.mkdtempSync(path.join(tmp, 'rel-'));
  const stage = path.join(dir, 'stage');
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(stage, rel)), { recursive: true });
    fs.writeFileSync(path.join(stage, rel), body);
  }
  const tarball = path.join(stage, 'kosmos.tar.gz');
  fs.writeFileSync(tarball, 'tarball ' + version);
  const m = { manifest: 1, version, arch: 'arm64', sha256: sha(fs.readFileSync(tarball)),
    files: Object.keys(files).sort().map((p) => ({ path: p, sha256: sha(Buffer.from(files[p])) })) };
  const manifest = path.join(dir, `kosmos-${version}-arm64.manifest.json`);
  fs.writeFileSync(manifest, JSON.stringify(m, null, 1) + '\n');
  fs.writeFileSync(manifest + '.sig', crypto.sign(null, fs.readFileSync(manifest), key).toString('base64') + '\n');
  return { dir, stage, tarball, manifest, sig: manifest + '.sig' };
}
const run = (r, version, installedVersion, keys = [PUB]) =>
  verify({ manifest: r.manifest, sig: r.sig, tarball: r.tarball, stage: r.stage, version, installedVersion, keys });

test('the shipped verifier pins at least one key', () => {
  assert.ok(KEYS.length >= 1);
  for (const k of KEYS) assert.doesNotThrow(() => crypto.createPublicKey({ key: Buffer.from(k, 'base64'), format: 'der', type: 'spki' }));
});

test('control: a release signed with the pinned key is trusted', () => {
  const r = release('1.2.3');
  assert.deepEqual(run(r, '1.2.3', '1.2.0').code, 0);
});

test('a manifest signed with another key is refused', () => {
  const r = release('1.2.3', { key: other.privateKey });
  assert.equal(run(r, '1.2.3', '1.2.0').code, 1);
});

test('a manifest changed after signing is refused', () => {
  const r = release('1.2.3');
  fs.appendFileSync(r.manifest, ' ');
  assert.equal(run(r, '1.2.3', '1.2.0').code, 1);
});

test('a changed file, an extra file, a missing file, and a symlink are each refused', () => {
  let r = release('1.2.3'); fs.writeFileSync(path.join(r.stage, 'app/server.js'), 'evil');
  assert.match(run(r, '1.2.3', '').why, /app\/server\.js does not match/);
  r = release('1.2.3'); fs.writeFileSync(path.join(r.stage, 'app/extra.js'), 'evil');
  assert.equal(run(r, '1.2.3', '').code, 1);
  r = release('1.2.3'); fs.rmSync(path.join(r.stage, 'app/server.js'));
  assert.equal(run(r, '1.2.3', '').code, 1);
  r = release('1.2.3'); fs.rmSync(path.join(r.stage, 'app/server.js')); fs.symlinkSync('/etc/hosts', path.join(r.stage, 'app/server.js'));
  assert.match(run(r, '1.2.3', '').why, /not a plain file/);
});

test('a tarball other than the signed one is refused', () => {
  const r = release('1.2.3');
  fs.appendFileSync(r.tarball, 'x');
  assert.match(run(r, '1.2.3', '').why, /does not match its signed manifest/);
});

test('an older signed release replayed, or one for another version, is refused', () => {
  const r = release('1.2.3');
  assert.match(run(r, '1.2.3', '1.3.0').why, /older than the installed/);
  assert.match(run(r, '1.2.4', '1.2.0').why, /is for 1\.2\.3, not 1\.2\.4/);
  assert.equal(run(r, '1.2.3', '1.2.3').code, 0, 'the same version again (a repair) is allowed');
});

test('no pinned key: exit 3 (nothing to check against)', () => {
  assert.equal(run(release('1.2.3'), '1.2.3', '', []).code, 3);
});

// ---- part 2: the installer calls the INSTALLED verifier ----

function installedHome(version) {
  const home = fs.mkdtempSync(path.join(tmp, 'home-'));
  fs.mkdirSync(path.join(home, 'app', 'engine'), { recursive: true });
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  const pinned = VERIFIER.replace(/const KEYS = \[[\s\S]*?\];/, `const KEYS = [${JSON.stringify(PUB)}];`);
  assert.notEqual(pinned, VERIFIER, 'the KEYS list moved; this fixture cannot pin its key');
  fs.writeFileSync(path.join(home, 'app', 'engine', 'manifest-verify.js'), pinned);
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  fs.writeFileSync(path.join(home, 'VERSION'), version + '\n');
  return home;
}
function setupCheck(r, home, target) {
  const script = ['set -eu', 'info() { printf "%s\\n" "$*"; }', fnSource('update_manifest_ok'),
    'update_manifest_ok "$1" "$2"'].join('\n');
  const env = { ...process.env, KOSMOS_RELEASE_BASE: 'file://' + r.dir, ARCH: 'arm64', TARGET_VERSION: target };
  const p = spawnSync('/bin/sh', ['-c', script, 'sh', r.stage, home], { encoding: 'utf8', env });
  return { code: p.status, out: p.stdout + p.stderr };
}

test('installer: a signed update is accepted by the installed verifier', () => {
  const r = setupCheck(release('1.2.3'), installedHome('1.2.0'), '1.2.3');
  assert.equal(r.code, 0, r.out);
});

test('installer: a tampered update is refused, in a sentence', () => {
  const rel = release('1.2.3');
  fs.writeFileSync(path.join(rel.stage, 'bin/kosmos'), 'evil');
  const r = setupCheck(rel, installedHome('1.2.0'), '1.2.3');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /bin\/kosmos does not match the signed manifest, so it was not installed/);
});

test('installer: a missing .sig is refused, not skipped', () => {
  const rel = release('1.2.3');
  fs.rmSync(rel.sig);
  const r = setupCheck(rel, installedHome('1.2.0'), '1.2.3');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /signed manifest could not be downloaded/);
});

test('installer: no target version is refused when the install can check', () => {
  const r = setupCheck(release('1.2.3'), installedHome('1.2.0'), '');
  assert.equal(r.code, 1, r.out);
});

test('installer: an install from before signing (no verifier) is not checked, and says so', () => {
  const home = installedHome('1.2.0');
  fs.rmSync(path.join(home, 'app', 'engine', 'manifest-verify.js'));
  const rel = release('1.2.3');
  fs.writeFileSync(path.join(rel.stage, 'bin/kosmos'), 'evil');
  const r = setupCheck(rel, home, '1.2.3');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /predates signed releases/);
});

test('installer: the check sits between unpacking and the first thing that runs', () => {
  const fn = SETUP.indexOf('\ninstall_kosmos() {\n');
  const tar = SETUP.indexOf('tar -xzf "$stage/kosmos.tar.gz"', fn);
  const call = SETUP.indexOf('! update_manifest_ok "$stage" "$dest"', fn);
  const rmTar = SETUP.indexOf('rm -f "$stage/kosmos.tar.gz"', fn);
  const probe = SETUP.indexOf('"$stage/runtime/bin/node" --version', fn);
  assert.ok(fn < tar && tar < call && call < rmTar && rmTar < probe, 'tar, then the check, then the tarball goes, then anything runs');
});
