'use strict';

/**
 * #6468 ask 3: an update checks the installer script against the target version's SIGNED manifest before it runs it.
 *
 * engine/manifest-verify.js verifySetup is driven with a throwaway key passed as the pinned list; runSetup (what
 * engine/update.js and `kosmos update` run) end to end over a file:// release base with a copy of the verifier whose
 * pinned list is rewritten to that key; the build records setup_sha256; the board words exit 97.
 *
 *   node --test install.setup-sig-6468.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const { verifySetup, NOT_RUN } = require('./engine/manifest-verify.js');
const VERIFIER = fs.readFileSync(path.join(__dirname, 'engine', 'manifest-verify.js'), 'utf8');
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

let tmp;
test.before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-setupsig-6468-')); });
test.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

/** A release host: dist/ with the manifest + .sig for `version`, and the installer at the base's sibling /setup. */
function host(version, { setupBody = 'echo ran-setup > "$MARK"\n', recorded, key = privateKey, noSig = false } = {}) {
  const root = fs.mkdtempSync(path.join(tmp, 'host-'));
  const dist = path.join(root, 'dist');
  fs.mkdirSync(dist);
  fs.writeFileSync(path.join(root, 'setup'), setupBody);
  const m = { manifest: 1, version, arch: 'arm64', files: [] };
  if (recorded !== null) m.setup_sha256 = recorded || sha(Buffer.from(setupBody));
  const mp = path.join(dist, `kosmos-${version}-arm64.manifest.json`);
  fs.writeFileSync(mp, JSON.stringify(m) + '\n');
  if (!noSig) fs.writeFileSync(mp + '.sig', crypto.sign(null, fs.readFileSync(mp), key).toString('base64') + '\n');
  return { root, dist, setup: path.join(root, 'setup'), manifest: mp, sig: mp + '.sig' };
}
/** An installed home whose verifier pins the throwaway key. */
function home(version) {
  const h = fs.mkdtempSync(path.join(tmp, 'home-'));
  fs.mkdirSync(path.join(h, 'app', 'engine'), { recursive: true });
  const pinned = VERIFIER.replace(/const KEYS = \[[\s\S]*?\];/, `const KEYS = [${JSON.stringify(PUB)}];`);
  assert.notEqual(pinned, VERIFIER, 'the KEYS list moved; this fixture cannot pin its key');
  fs.writeFileSync(path.join(h, 'app', 'engine', 'manifest-verify.js'), pinned);
  fs.writeFileSync(path.join(h, 'app', 'package.json'), JSON.stringify({ version }) + '\n');
  return h;
}
function runSetup(h, hst, version) {
  const mark = path.join(tmp, 'mark-' + crypto.randomBytes(4).toString('hex'));
  const r = spawnSync(process.execPath, [path.join(h, 'app', 'engine', 'manifest-verify.js'), 'run-setup',
    'file://' + hst.setup, 'file://' + hst.dist, version, h], { encoding: 'utf8', env: { ...process.env, MARK: mark } });
  return { code: r.status, err: r.stderr, ran: fs.existsSync(mark) };
}

test('verifySetup: CONTROL: the installer the signed manifest names passes', () => {
  const h = host('1.2.3');
  assert.equal(verifySetup({ manifest: h.manifest, sig: h.sig, setup: h.setup, version: '1.2.3', installedVersion: '1.2.0', keys: [PUB] }).code, 0);
});
test('verifySetup: another installer, another key, another version, an older one: refused', () => {
  const h = host('1.2.3');
  fs.appendFileSync(h.setup, 'echo extra\n');
  assert.match(verifySetup({ manifest: h.manifest, sig: h.sig, setup: h.setup, version: '1.2.3', installedVersion: '1.2.0', keys: [PUB] }).why, /does not match its signed release/);
  const o = crypto.generateKeyPairSync('ed25519');
  const h2 = host('1.2.3', { key: o.privateKey });
  assert.equal(verifySetup({ manifest: h2.manifest, sig: h2.sig, setup: h2.setup, version: '1.2.3', installedVersion: '1.2.0', keys: [PUB] }).code, 1);
  const h3 = host('1.2.3');
  assert.equal(verifySetup({ manifest: h3.manifest, sig: h3.sig, setup: h3.setup, version: '1.2.4', installedVersion: '1.2.0', keys: [PUB] }).code, 1);
  assert.match(verifySetup({ manifest: h3.manifest, sig: h3.sig, setup: h3.setup, version: '1.2.3', installedVersion: '1.3.0', keys: [PUB] }).why, /older than the installed/);
});
test('verifySetup: a manifest that records no installer is exit 3 (cut before this), not a pass', () => {
  const h = host('1.2.3', { recorded: null });
  assert.equal(verifySetup({ manifest: h.manifest, sig: h.sig, setup: h.setup, version: '1.2.3', installedVersion: '1.2.0', keys: [PUB] }).code, 3);
});

test('run-setup: CONTROL: a matching installer runs, and its exit code comes back', () => {
  const r = runSetup(home('1.2.0'), host('1.2.3'), '1.2.3');
  assert.equal(r.code, 0, r.err);
  assert.equal(r.ran, true);
  const r2 = runSetup(home('1.2.0'), host('1.2.3', { setupBody: 'exit 7\n' }), '1.2.3');
  assert.equal(r2.code, 7, r2.err);
});
test('run-setup: a tampered installer, a missing .sig, or an unknown version runs NOTHING and exits 97', () => {
  const hst = host('1.2.3');
  fs.appendFileSync(hst.setup, 'echo planted\n');
  let r = runSetup(home('1.2.0'), hst, '1.2.3');
  assert.equal(r.code, NOT_RUN, r.err);
  assert.equal(r.ran, false);
  assert.match(r.err, /does not match its signed release, so the installer was not run/);
  r = runSetup(home('1.2.0'), host('1.2.3', { noSig: true }), '1.2.3');
  assert.equal(r.code, NOT_RUN, r.err);
  assert.equal(r.ran, false);
  r = runSetup(home('1.2.0'), host('1.2.3'), '');
  assert.equal(r.code, NOT_RUN, r.err);
  assert.equal(r.ran, false);
});
test('run-setup: NODE_OPTIONS is not handed to the installer, and it gets no stdin', () => {
  const hst = host('1.2.3', { setupBody: 'printf "opts=[%s]\\n" "${NODE_OPTIONS:-}" > "$MARK.env"; if read -r x; then echo got > "$MARK.in"; fi; : > "$MARK"\n' });
  const mark = path.join(tmp, 'mark-env');
  const h = home('1.2.0');
  const r = spawnSync(process.execPath, [path.join(h, 'app', 'engine', 'manifest-verify.js'), 'run-setup',
    'file://' + hst.setup, 'file://' + hst.dist, '1.2.3', h], { encoding: 'utf8', input: 'typed\n', env: { ...process.env, MARK: mark, NODE_OPTIONS: '--no-warnings' } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(mark + '.env', 'utf8'), 'opts=[]\n');
  assert.equal(fs.existsSync(mark + '.in'), false, 'the installer read stdin');
});

test('the build records setup_sha256 from install/setup.sh in the manifest it signs', () => {
  const src = fs.readFileSync(path.join(__dirname, 'tools', 'build-kosmos-bundle.sh'), 'utf8');
  assert.match(src, /KM_SETUP_SHA="\$\(shasum -a 256 "\$REPO\/install\/setup\.sh"/);
  assert.match(src, /setup_sha256: e\.KM_SETUP_SHA,/);
});
test('the board words exit 97 as "could not be checked", not as a crash', () => {
  const src = fs.readFileSync(path.join(__dirname, 'engine', 'update.js'), 'utf8');
  assert.match(src, /if \(s\.code === 97\) return \{[^}]*because: 'the update could not be checked against its signed release, so nothing was installed'/);
});
