'use strict';

/**
 * #6473: the tmux bundle the Mac installer fetches is held to the tmux_sha256 of the target release's SIGNED manifest,
 * which the installer fetches and checks first (update_manifest_ok early), using the installed copy's verifier.
 *
 * Part 1 drives engine/manifest-verify.js verifyTmux with a throwaway key as the pinned list. Part 2 runs the real
 * update_manifest_ok (early, then pre) and update_tmux_ok from install/setup.sh under /bin/sh against a fake installed
 * home whose verifier pins that key, and a file:// release base.
 *
 *   node --test install.tmux-sig-6473.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const { verifyTmux } = require('./engine/manifest-verify.js');
const SETUP = fs.readFileSync(path.join(__dirname, 'install', 'setup.sh'), 'utf8');
const VERIFIER = fs.readFileSync(path.join(__dirname, 'engine', 'manifest-verify.js'), 'utf8');
function fnSource(name) {
  const at = SETUP.indexOf('\n' + name + '() {\n');
  assert.notEqual(at, -1, name + ' is gone from install/setup.sh');
  return SETUP.slice(at + 1, SETUP.indexOf('\n}\n', at) + 3);
}
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

let tmp;
test.before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-tmuxsig-6473-')); });
test.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

/** A release host for `version`: a tmux tarball stand-in, a kosmos tarball stand-in, and the signed manifest. */
function host(version, { tmuxRecorded, key = privateKey } = {}) {
  const dir = fs.mkdtempSync(path.join(tmp, 'rel-'));
  const tmux = path.join(dir, 'tmux.tar.gz');
  fs.writeFileSync(tmux, 'tmux bytes ' + version);
  const tgz = path.join(dir, 'kosmos.tar.gz');
  fs.writeFileSync(tgz, 'kosmos bytes ' + version);
  const m = { manifest: 1, version, arch: 'arm64', sha256: sha(fs.readFileSync(tgz)), files: [] };
  if (tmuxRecorded !== null) m.tmux_sha256 = tmuxRecorded || sha(fs.readFileSync(tmux));
  const mp = path.join(dir, `kosmos-${version}-arm64.manifest.json`);
  fs.writeFileSync(mp, JSON.stringify(m) + '\n');
  fs.writeFileSync(mp + '.sig', crypto.sign(null, fs.readFileSync(mp), key).toString('base64') + '\n');
  return { dir, tmux, tgz, manifest: mp, sig: mp + '.sig' };
}
function installedHome(version) {
  const home = fs.mkdtempSync(path.join(tmp, 'home-'));
  fs.mkdirSync(path.join(home, 'app', 'engine'), { recursive: true });
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  const pinned = VERIFIER.replace(/const KEYS = \[[\s\S]*?\];/, `const KEYS = [${JSON.stringify(PUB)}];`);
  assert.notEqual(pinned, VERIFIER, 'the KEYS list moved; this fixture cannot pin its key');
  fs.writeFileSync(path.join(home, 'app', 'engine', 'manifest-verify.js'), pinned);
  fs.writeFileSync(path.join(home, 'app', 'package.json'), JSON.stringify({ version }) + '\n');
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  return home;
}
/** Runs `body` (shell) with the real functions lifted out of setup.sh, as setup.sh would. */
function sh(r, home, target, body) {
  const script = ['set -eu', 'info() { printf "%s\\n" "$*"; }', '_UM_DIR=""', '_UM_NOKEY=""', '_UM_SAID=""',
    fnSource('update_manifest_ok'), fnSource('update_tmux_ok'), body].join('\n');
  const env = { ...process.env, KOSMOS_RELEASE_BASE: 'file://' + r.dir, ARCH: 'arm64', TARGET_VERSION: target, TMPDIR: tmp, KOSMOS_HOME: home };
  const p = spawnSync('/bin/sh', ['-c', script, 'sh', r.tmux, home, r.dir], { encoding: 'utf8', env });
  return { code: p.status, out: p.stdout + p.stderr };
}
const EARLY_THEN_TMUX = 'update_manifest_ok early "" "$2" || { echo "refused at early"; exit 1; }\nupdate_tmux_ok "$1" "$2" || { echo "refused at tmux"; exit 1; }\necho "tmux-ok"';

test('verifyTmux: CONTROL: the tmux the signed manifest records passes', () => {
  const h = host('1.2.3');
  assert.equal(verifyTmux({ manifest: h.manifest, sig: h.sig, tmux: h.tmux, version: '1.2.3', installedVersion: '1.2.0', keys: [PUB] }).code, 0);
});
test('verifyTmux: other bytes, no tmux recorded, another key: refused', () => {
  const h = host('1.2.3');
  fs.appendFileSync(h.tmux, 'x');
  assert.match(verifyTmux({ manifest: h.manifest, sig: h.sig, tmux: h.tmux, version: '1.2.3', installedVersion: '1.2.0', keys: [PUB] }).why, /does not match its signed release/);
  const h2 = host('1.2.3', { tmuxRecorded: null });
  assert.match(verifyTmux({ manifest: h2.manifest, sig: h2.sig, tmux: h2.tmux, version: '1.2.3', installedVersion: '1.2.0', keys: [PUB] }).why, /records no tmux bundle/);
  const o = crypto.generateKeyPairSync('ed25519');
  const h3 = host('1.2.3', { key: o.privateKey });
  assert.equal(verifyTmux({ manifest: h3.manifest, sig: h3.sig, tmux: h3.tmux, version: '1.2.3', installedVersion: '1.2.0', keys: [PUB] }).code, 1);
});

test('installer: CONTROL: early fetches and checks the manifest, then the matching tmux passes', () => {
  const r = sh(host('1.2.3'), installedHome('1.2.0'), '1.2.3', EARLY_THEN_TMUX);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /tmux-ok/);
});
test('installer: a tmux download other than the signed one is refused before it is unpacked', () => {
  const h = host('1.2.3');
  fs.appendFileSync(h.tmux, 'planted');
  const r = sh(h, installedHome('1.2.0'), '1.2.3', EARLY_THEN_TMUX);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /terminal manager download does not match its signed release, so it was not installed/);
  assert.match(r.out, /refused at tmux/);
});
test('installer: early refuses a manifest signed by another key, before tmux is fetched', () => {
  const o = crypto.generateKeyPairSync('ed25519');
  const r = sh(host('1.2.3', { key: o.privateKey }), installedHome('1.2.0'), '1.2.3', EARLY_THEN_TMUX);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /refused at early/);
});
test('installer: pre reuses the manifest early fetched (no second download) and still checks the kosmos tarball', () => {
  const h = host('1.2.3');
  const stage = fs.mkdtempSync(path.join(tmp, 'stage-'));
  fs.copyFileSync(h.tgz, path.join(stage, 'kosmos.tar.gz'));
  const body = `update_manifest_ok early "" "$2" || exit 1
rm -f "$3"/kosmos-1.2.3-arm64.manifest.json "$3"/kosmos-1.2.3-arm64.manifest.json.sig
update_manifest_ok pre "${stage}" "$2" || { echo "refused at pre"; exit 1; }
echo "pre-ok"`;
  let r = sh(h, installedHome('1.2.0'), '1.2.3', body);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /pre-ok/);
  fs.appendFileSync(path.join(stage, 'kosmos.tar.gz'), 'x');
  r = sh(host('1.2.3'), installedHome('1.2.0'), '1.2.3', body.replace(/rm -f[^\n]*\n/, ''));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /refused at pre/);
});
test('installer: an install with no verifier fetches nothing early and does not hold tmux', () => {
  const home = installedHome('1.2.0');
  fs.rmSync(path.join(home, 'app', 'engine', 'manifest-verify.js'));
  const h = host('1.2.3');
  fs.appendFileSync(h.tmux, 'x');
  const r = sh(h, home, '1.2.3', EARLY_THEN_TMUX);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /predates signed releases/);
});

test('setup.sh runs the early check before fetch_tmux, and fetch_tmux checks before tar', () => {
  const early = SETUP.indexOf('update_manifest_ok early "" "$KOSMOS_HOME"');
  const fetch = SETUP.indexOf('\nfetch_tmux "$KOSMOS_HOME/tmux"');
  assert.ok(early > -1 && fetch > -1 && early < fetch, 'the early manifest check must come before fetch_tmux');
  const fn = SETUP.indexOf('\nfetch_tmux() {\n');
  const chk = SETUP.indexOf('update_tmux_ok "$stage/tmux.tar.gz" "$KOSMOS_HOME"', fn);
  const tar = SETUP.indexOf('tar -xzf "$stage/tmux.tar.gz"', fn);
  assert.ok(fn < chk && chk < tar, 'fetch_tmux must check the download before tar');
});
test('release.sh copies the tmux pair in before the build and checks the manifest records it', () => {
  const rel = fs.readFileSync(path.join(__dirname, 'tools', 'release.sh'), 'utf8');
  const cp = rel.indexOf('cp "$SITE/dist/tmux-arm64.tar.gz" "$SITE/dist/tmux-arm64.tar.gz.sha256" "$REPO/dist/"');
  const build = rel.indexOf('( cd "$REPO" && bash tools/build-kosmos-bundle.sh dist )');
  assert.ok(cp > -1 && build > -1 && cp < build, 'the tmux pair must be in dist before the build');
  assert.match(rel, /does not record the tmux bundle this cut serves \(#6473\)/);
});
