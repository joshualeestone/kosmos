'use strict';
require('../test-support/tmpscope');   // kosmos#4273: every temp folder this file makes is removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * kosmos#7281 slice D: one key signs every release family, so the verifier refuses a genuine manifest that NAMES
 * another platform (a Linux build served at a Mac address, or a Mac-named one on Linux), and run-setup reads the
 * Linux family's manifest on a Linux x86_64 copy that runs its own node. The platform is a parameter, so every arm
 * runs from any OS.
 *
 *   node --test engine/manifest-verify.linux-family-7281.test.js
 */

const mv = require('./manifest-verify');

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-mvlinux-7281-'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/* A signed release whose manifest carries `platform` (undefined: none, as the Mac's). */
function release(version, platform) {
  const dir = fs.mkdtempSync(path.join(WORK, 'rel-'));
  const stage = path.join(dir, 'stage');
  const files = { 'bin/kosmos': '#!/bin/sh\n', 'app/server.js': 'x', 'runtime/bin/node': 'n', VERSION: version + '\n' };
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(stage, rel)), { recursive: true });
    fs.writeFileSync(path.join(stage, rel), body);
  }
  const tarball = path.join(stage, 'kosmos.tar.gz');
  fs.writeFileSync(tarball, 'tarball ' + version);
  const m = { manifest: 1, version, arch: platform === 'linux' ? 'linux-x64' : 'arm64', sha256: sha(fs.readFileSync(tarball)),
    files: Object.keys(files).sort().map((p) => ({ path: p, sha256: sha(Buffer.from(files[p])) })) };
  if (platform !== undefined) m.platform = platform;
  const manifest = path.join(dir, 'manifest.json');
  fs.writeFileSync(manifest, JSON.stringify(m, null, 1) + '\n');
  fs.writeFileSync(manifest + '.sig', crypto.sign(null, fs.readFileSync(manifest), privateKey).toString('base64') + '\n');
  return { manifest, sig: manifest + '.sig', tarball, stage };
}
const check = (r, platform, extra) => mv.verify({ manifest: r.manifest, sig: r.sig, tarball: r.tarball, stage: r.stage,
  version: '1.2.3', installedVersion: '1.2.0', keys: [PUB], platform, ...(extra || {}) });

test('#7281: a Mac refuses a genuine manifest that names another platform', () => {
  const linux = check(release('1.2.3', 'linux'), 'darwin');
  assert.equal(linux.code, 1, 'a Linux build passed the Mac verifier');
  assert.match(linux.why, /"linux", not macOS/);
  assert.equal(check(release('1.2.3', 'win32'), 'darwin').code, 1);
  // CONTROLS: the Mac's own manifest (no platform) and one that says darwin.
  assert.equal(check(release('1.2.3', undefined), 'darwin').code, 0);
  assert.equal(check(release('1.2.3', 'darwin'), 'darwin').code, 0);
});

test('#7281: Linux refuses a manifest that names another platform, and takes its own', () => {
  assert.equal(check(release('1.2.3', 'linux'), 'linux').code, 0, 'CONTROL: the Linux family');
  const mac = check(release('1.2.3', 'darwin'), 'linux');
  assert.equal(mac.code, 1, 'a darwin-named build passed the Linux verifier');
  assert.match(mac.why, /"darwin", not Linux/);
  // A manifest naming none (the portable bundle's Mac manifest) is still taken on Linux; see platformRefusal.
  assert.equal(check(release('1.2.3', undefined), 'linux').code, 0);
});

test('#7281 review 1: a copy that runs the Linux family takes only a manifest that says linux', () => {
  const unnamed = check(release('1.2.3', undefined), 'linux', { ownLinux: true });
  assert.equal(unnamed.code, 1, 'a Linux-family copy took the Mac build under the Linux name');
  assert.match(unnamed.why, /"macOS", not Linux/);
  assert.equal(check(release('1.2.3', 'linux'), 'linux', { ownLinux: true }).code, 0, 'CONTROL: its own family');
});

test('#7281: the installer check alone is not held to the platform (both families carry the same setup.sh)', () => {
  const r = check(release('1.2.3', 'linux'), 'darwin', { skipTarball: true });
  assert.equal(r.code, 0);
});

test('#7281: run-setup reads the Linux manifest only on a Linux x86_64 copy that runs its own node', () => {
  const home = (linked) => {
    const h = fs.mkdtempSync(path.join(WORK, 'home-'));
    fs.mkdirSync(path.join(h, 'runtime', 'bin'), { recursive: true });
    const own = path.join(h, 'runtime', 'bin', linked ? 'system-node' : 'node');
    fs.writeFileSync(own, '#!/bin/sh\n', { mode: 0o755 });
    if (linked) fs.symlinkSync(own, path.join(h, 'runtime', 'bin', 'node'));
    return h;
  };
  const own = home(false); const portable = home(true);
  assert.equal(mv.setupManifestName('1.2.3', own, { platform: 'linux', arch: 'x64' }), 'kosmos-1.2.3-linux-x64.manifest.json');
  // CONTROLS: the portable bundle, an ARM Linux computer and a Mac keep the Mac manifest.
  assert.equal(mv.setupManifestName('1.2.3', portable, { platform: 'linux', arch: 'x64' }), 'kosmos-1.2.3-arm64.manifest.json');
  assert.equal(mv.setupManifestName('1.2.3', own, { platform: 'linux', arch: 'arm64' }), 'kosmos-1.2.3-arm64.manifest.json');
  assert.equal(mv.setupManifestName('1.2.3', own, { platform: 'darwin', arch: 'arm64' }), 'kosmos-1.2.3-arm64.manifest.json');
});
