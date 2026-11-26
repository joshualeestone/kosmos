'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#7116 step 2: the SBOM (tools/lib/sbom.js) accepts app/bin/kosmos-se, the Secure Enclave admin signer, as a
 * first-party binary, and checks its source (native-se/main.swift at the app commit) as it checks the Mac app's: Apple
 * frameworks only, no conditional. The import reader is stood in for (the real one needs xcrun), except in the last
 * test, which reads the real file when swiftc is here.
 *
 *   node --test tools.sbom-kosmosse-7116.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const sbom = require('./tools/lib/sbom');

const REAL = fs.readFileSync(path.join(__dirname, 'native-se', 'main.swift'), 'utf8');
const ships = { files: [{ path: 'app/bin/kosmos-se', sha256: 'a'.repeat(64) }] };
const showing = (src) => (repo, commit, file) => { if (file !== 'native-se/main.swift') throw new Error('unexpected ' + file); if (src === null) throw new Error('missing'); return src; };
const imports = (mods) => () => mods;

test('#7116: a release shipping kosmos-se passes when its source imports Apple frameworks only (CryptoKit, Foundation, LocalAuthentication)', () => {
  assert.doesNotThrow(() => sbom.checkSeHelper(ships, showing(REAL), 'r', 'c', 'arm64-apple-macos13.5', imports(['CryptoKit', 'Foundation', 'LocalAuthentication'])));
});

test('#7116: a non-Apple import, a missing source, or a conditional refuses; a release without kosmos-se is not checked', () => {
  assert.throws(() => sbom.checkSeHelper(ships, showing(REAL), 'r', 'c', 'arm64-apple-macos13.5', imports(['Foundation', 'SomePackage'])),
    /native-se\/main\.swift imports SomePackage/);
  assert.throws(() => sbom.checkSeHelper(ships, showing(null), 'r', 'c', 'arm64-apple-macos13.5', imports([])), /native-se\/main\.swift is not in the app commit/);
  assert.throws(() => sbom.checkSeHelper(ships, showing('import Foundation\n#if DEBUG\n#endif\n'), 'r', 'c', 'arm64-apple-macos13.5', imports(['Foundation'])),
    /native-se\/main\.swift has a conditional/);
  // CONTROL: no kosmos-se in the manifest, nothing read (the stand-in would throw on any read).
  assert.doesNotThrow(() => sbom.checkSeHelper({ files: [{ path: 'app/bin/kosmos-app', sha256: 'a'.repeat(64) }] }, () => { throw new Error('read'); }, 'r', 'c', 't', () => { throw new Error('read'); }));
});

const swiftc = spawnSync('/usr/bin/xcrun', ['--find', 'swiftc'], { encoding: 'utf8' });
test('#7116: the real native-se/main.swift, read by the Swift compiler, imports only frameworks the SBOM knows', { skip: swiftc.status !== 0 ? 'needs xcrun swiftc' : false }, () => {
  const mods = sbom.swiftcImports(REAL, 'arm64-apple-macos' + fs.readFileSync(path.join(__dirname, 'tools', 'macos-floor'), 'utf8').trim(), 'native-se/main.swift');
  assert.ok(mods.includes('CryptoKit') && mods.includes('LocalAuthentication'), mods.join(','));
  assert.doesNotThrow(() => sbom.checkSeHelper(ships, showing(REAL), 'r', 'c', 'arm64-apple-macos13.5', () => mods));
});
