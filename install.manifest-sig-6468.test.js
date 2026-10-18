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
  assert.match(run(r, '1.2.3', '1.2.0').why, /app\/server\.js does not match/);
  r = release('1.2.3'); fs.writeFileSync(path.join(r.stage, 'app/extra.js'), 'evil');
  assert.equal(run(r, '1.2.3', '1.2.0').code, 1);
  r = release('1.2.3'); fs.rmSync(path.join(r.stage, 'app/server.js'));
  assert.equal(run(r, '1.2.3', '1.2.0').code, 1);
  r = release('1.2.3'); fs.rmSync(path.join(r.stage, 'app/server.js')); fs.symlinkSync('/etc/hosts', path.join(r.stage, 'app/server.js'));
  assert.match(run(r, '1.2.3', '1.2.0').why, /not a plain file/);
});

test('a tarball other than the signed one is refused', () => {
  const r = release('1.2.3');
  fs.appendFileSync(r.tarball, 'x');
  assert.match(run(r, '1.2.3', '1.2.0').why, /does not match its signed manifest/);
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

/** An installed home as a real build leaves it: VERSION in the build's own three-line shape, the version in
 *  app/package.json, and the verifier with its pinned key list rewritten to the throwaway key. */
function installedHome(version, keys = [PUB]) {
  const home = fs.mkdtempSync(path.join(tmp, 'home-'));
  fs.mkdirSync(path.join(home, 'app', 'engine'), { recursive: true });
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  const pinned = VERIFIER.replace(/const KEYS = \[[\s\S]*?\];/, `const KEYS = ${JSON.stringify(keys)};`);
  assert.notEqual(pinned, VERIFIER, 'the KEYS list moved; this fixture cannot pin its key');
  fs.writeFileSync(path.join(home, 'app', 'engine', 'manifest-verify.js'), pinned);
  fs.writeFileSync(path.join(home, 'app', 'package.json'), JSON.stringify({ name: 'kosmos', version }, null, 2) + '\n');
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  fs.writeFileSync(path.join(home, 'VERSION'), `app:    14fe852ed7 (package.json ${version})\nnode:   v24.19.0\nbuilt:  2026-10-17T07:26:51Z on macOS 27.0.1\n`);
  return home;
}
/** Runs the real update_manifest_ok for the given phases in ONE shell (they share _UM_DIR), as install_kosmos does. */
function setupCheck(r, home, target, phases = ['pre', 'post'], env = {}) {
  const calls = phases.map((ph) => `update_manifest_ok ${ph} "$1" "$2" || { echo "refused at ${ph}"; exit 1; }`);
  const script = ['set -eu', 'info() { printf "%s\\n" "$*"; }', '_UM_DIR=""', '_UM_NOKEY=""', fnSource('update_manifest_ok'),
    ...calls, 'printf "leftover=%s\\n" "$_UM_DIR"'].join('\n');
  const e = { ...process.env, KOSMOS_RELEASE_BASE: 'file://' + r.dir, ARCH: 'arm64', TARGET_VERSION: target, TMPDIR: tmp, ...env };
  const p = spawnSync('/bin/sh', ['-c', script, 'sh', r.stage, home], { encoding: 'utf8', env: e });
  return { code: p.status, out: p.stdout + p.stderr };
}

test('installer: a signed update is accepted by the installed verifier, and leaves nothing behind', () => {
  const r = setupCheck(release('1.2.3'), installedHome('1.2.0'), '1.2.3');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /leftover=\n/);
});

test('installer: a tampered file is refused after unpacking, in a sentence', () => {
  const rel = release('1.2.3');
  fs.writeFileSync(path.join(rel.stage, 'bin/kosmos'), 'evil');
  const r = setupCheck(rel, installedHome('1.2.0'), '1.2.3');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /bin\/kosmos does not match the signed manifest, so it was not installed/);
  assert.match(r.out, /refused at post/);
});

test('installer: a tarball other than the signed one is refused BEFORE it is unpacked', () => {
  const rel = release('1.2.3');
  fs.appendFileSync(rel.tarball, 'x');
  const r = setupCheck(rel, installedHome('1.2.0'), '1.2.3', ['pre']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /refused at pre/);
});

test('installer: an older signed release is refused against a real-shaped install (VERSION is not a bare number)', () => {
  const r = setupCheck(release('1.2.3'), installedHome('1.3.0'), '1.2.3', ['pre']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /older than the installed 1\.3\.0/);
});

test('installer: an install whose version cannot be read is refused, not waved through', () => {
  const home = installedHome('1.2.0');
  fs.writeFileSync(path.join(home, 'app', 'package.json'), '{"name":"kosmos"}\n');
  let r = setupCheck(release('1.2.3'), home, '1.2.3', ['pre']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /installed version could not be read/);
  // A package.json node itself cannot parse: still refused, in one plain sentence, no stack trace in the log.
  fs.writeFileSync(path.join(home, 'app', 'package.json'), '{');
  r = setupCheck(release('1.2.3'), home, '1.2.3', ['pre']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^the update could not be checked, so it was not installed$/m);
  assert.doesNotMatch(r.out, /node:internal|^\s+at /m);
});

test('installer: a link the archive plants where a manifest might be written is never written through', () => {
  const rel = release('1.2.3');
  const victim = path.join(tmp, 'victim-' + process.pid);
  fs.writeFileSync(victim, 'untouched\n');
  for (const n of ['.manifest.json', '.manifest.sig', 'manifest.json', 'manifest.sig']) fs.symlinkSync(victim, path.join(rel.stage, n));
  const r = setupCheck(rel, installedHome('1.2.0'), '1.2.3', ['pre']);
  assert.equal(r.code, 0, r.out);
  assert.equal(fs.readFileSync(victim, 'utf8'), 'untouched\n');
});

test('installer: NODE_OPTIONS from the environment does not reach the verifier', () => {
  const marker = path.join(tmp, 'preload-ran-' + process.pid);
  const pre = path.join(tmp, 'preload.js');
  fs.writeFileSync(pre, `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')`);
  const r = setupCheck(release('1.2.3'), installedHome('1.2.0'), '1.2.3', ['pre'], { NODE_OPTIONS: '--require ' + pre });
  assert.equal(r.code, 0, r.out);
  assert.equal(fs.existsSync(marker), false);
});

test('installer: an install that pins no key is not checked, through BOTH phases, and says so', () => {
  const r = setupCheck(release('1.2.3'), installedHome('1.2.0', []), '1.2.3');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /no release signing key is pinned/);
  assert.match(r.out, /leftover=\n/);
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
  assert.match(r.out, /could not read which version to install/);
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

test('installer: the archive is checked before tar reads it, and every file before anything runs', () => {
  const fn = SETUP.indexOf('\ninstall_kosmos() {\n');
  const pre = SETUP.indexOf('! update_manifest_ok pre "$stage" "$dest"', fn);
  const tar = SETUP.indexOf('tar -xzf "$stage/kosmos.tar.gz"', fn);
  const post = SETUP.indexOf('! update_manifest_ok post "$stage" "$dest"', fn);
  const rmTar = SETUP.indexOf('rm -f "$stage/kosmos.tar.gz"', fn);
  const probe = SETUP.indexOf('"$stage/runtime/bin/node" --version', fn);
  assert.ok(fn < pre && pre < tar && tar < post && post < rmTar && rmTar < probe, 'pre, tar, post, the tarball goes, then anything runs');
});

// ---- the release's half: tools/lib/manifest-sign.js ----
const SIGN = path.join(__dirname, 'tools', 'lib', 'manifest-sign.js');
const signRun = (...args) => spawnSync(process.execPath, [SIGN, ...args], { encoding: 'utf8' });

test('release: a real ed25519 key that is not pinned is refused by check and sign', () => {
  const k = path.join(tmp, 'unpinned.pem');
  fs.writeFileSync(k, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  assert.equal(signRun('check', k).status, 1);
  const rel = release('1.2.3');
  const out = path.join(rel.dir, 'out.sig');
  assert.equal(signRun('sign', k, rel.manifest, out).status, 1);
  assert.equal(fs.existsSync(out), false, 'an unpinned key wrote a signature');
});

test('release: verify accepts only a pinned signature; CONTROL: a throwaway key\'s signature is refused', () => {
  const rel = release('1.2.3');
  assert.equal(signRun('verify', rel.manifest, rel.sig).status, 1, 'the throwaway key is not pinned in the shipped list');
  assert.equal(signRun('verify', rel.manifest, path.join(rel.dir, 'missing.sig')).status, 1);
});

test('release: needs-sig is yes only for a release that ships the verifier', () => {
  const rel = release('1.2.3', { files: { 'app/engine/manifest-verify.js': 'x', VERSION: '1.2.3\n' } });
  assert.equal(signRun('needs-sig', rel.manifest).status, 0);
  assert.equal(signRun('needs-sig', release('1.2.3').manifest).status, 1);
  const bad = path.join(tmp, 'bad-manifest.json');
  fs.writeFileSync(bad, '{');
  assert.equal(signRun('needs-sig', bad).status, 2, 'an unreadable manifest is "cannot tell", not "no"');
  assert.equal(signRun('needs-sig', path.join(tmp, 'absent.json')).status, 2);
});

// ---- the served check after a deploy: tools/verify-manifest.sh ----
const VM = path.join(__dirname, 'tools', 'verify-manifest.sh');
function servedDist({ sig }) {
  const dist = fs.mkdtempSync(path.join(tmp, 'served-'));
  const tree = fs.mkdtempSync(path.join(tmp, 'tree-'));
  fs.mkdirSync(path.join(tree, 'bin')); fs.writeFileSync(path.join(tree, 'bin', 'kosmos'), '#!/bin/sh\n');
  fs.mkdirSync(path.join(tree, 'app')); fs.writeFileSync(path.join(tree, 'app', 'server.js'), 'x');
  fs.mkdirSync(path.join(tree, 'runtime')); fs.writeFileSync(path.join(tree, 'runtime', 'n'), 'n');
  fs.writeFileSync(path.join(tree, 'VERSION'), 'app: x\n');
  const tgz = path.join(dist, 'kosmos-1.2.3-arm64.tar.gz');
  spawnSync('/usr/bin/tar', ['-czf', tgz, '-C', tree, 'bin', 'app', 'runtime', 'VERSION']);
  const files = ['VERSION', 'app/server.js', 'bin/kosmos', 'runtime/n'].map((p) => ({ path: p, sha256: sha(fs.readFileSync(path.join(tree, p))) }));
  const m = { manifest: 1, version: '1.2.3', arch: 'arm64', artifact: 'kosmos-arm64.tar.gz', sha256: sha(fs.readFileSync(tgz)),
    app: { commit: 'c', dirty: false }, node: { version: 'v', download_sha256: 'd' },
    connector: { signed_sha256: 'aaaaaaaaaaaaaaaa', input_sha256: 'bbbbbbbbbbbbbbbb', commit: 'c' },
    built: { at: 't', host: 'h', macos: 'm' }, files };
  const mp = path.join(dist, 'kosmos-1.2.3-arm64.manifest.json');
  fs.writeFileSync(mp, JSON.stringify(m, null, 1) + '\n');
  if (sig === 'bad') fs.writeFileSync(mp + '.sig', crypto.sign(null, fs.readFileSync(mp), privateKey).toString('base64') + '\n');
  return dist;
}
const vm = (dist, env = {}) => spawnSync('/bin/bash', [VM, '1.2.3'], { encoding: 'utf8', env: { ...process.env, KOSMOS_BASE: 'file://' + dist, KOSMOS_REQUIRE_SIG: '', ...env } });

test('served check: CONTROL: with no .sig and none required, the rest of the check runs and passes', () => {
  const r = vm(servedDist({ sig: null }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /no signature served/);
  assert.match(r.stdout, /every file matches the manifest/);
});
test('served check: a cut (KOSMOS_REQUIRE_SIG=1) with no .sig served fails', () => {
  const r = vm(servedDist({ sig: null }), { KOSMOS_REQUIRE_SIG: '1' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /SIGNATURE: no kosmos-1\.2\.3-arm64\.manifest\.json\.sig served/);
});
test('served check: a .sig that is not a pinned key\'s fails, required or not', () => {
  for (const req of ['', '1']) {
    const r = vm(servedDist({ sig: 'bad' }), { KOSMOS_REQUIRE_SIG: req });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /SIGNATURE: the served \.sig does not verify/);
  }
});
