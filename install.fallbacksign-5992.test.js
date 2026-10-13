'use strict';
/*
 * #5992: the per-install Kosmos.app that build_app_bundle assembles (the fallback when the sealed app cannot be
 * placed) must carry a valid signature. A folder assembled around the signed kosmos-app has no _CodeSignature, so the
 * bundle does not verify and macOS calls it "damaged" (Josh, 2026-10-12, on a 0.7.38 icon).
 *
 * The REAL build_app_bundle is lifted out of setup.sh and run under /bin/sh against a home whose bin/kosmos-app is a
 * lone Mach-O signed the way the cut signs kosmos-app (ad hoc here, no keychain): hardened runtime, with the app's own
 * entitlements file.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

// macOS only: codesign runs below. The Linux lane runs every root test file, so the whole file skips there.
const MAC = process.platform === 'darwin' || 'macOS codesign';
const it = (name, fn) => test(name, { skip: MAC === true ? false : MAC }, fn);
const SETUP = fs.readFileSync(path.join(__dirname, 'install', 'setup.sh'), 'utf8');
function fnSource(src, name) {
  const at = src.indexOf('\n' + name + '() {\n');
  assert.notEqual(at, -1, name + ' is gone from install/setup.sh');
  const end = src.indexOf('\n}\n', at);
  return src.slice(at + 1, end + 3);
}

let tmpRoot;
test.before(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fallbacksign-5992-')); });
test.after(() => { if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true }); });

const ENTITLEMENTS = path.join(__dirname, 'native-app', 'kosmos-app.entitlements');
// A home whose app/bin/kosmos-app is a lone Mach-O signed with the hardened runtime and the app's entitlements.
// icnsAttr: also ship an icon carrying a Finder-info attribute, which codesign refuses inside a bundle.
function makeHome({ icnsAttr = false } = {}) {
  const home = fs.mkdtempSync(path.join(tmpRoot, 'home-'));
  fs.mkdirSync(path.join(home, 'app', 'bin'), { recursive: true });
  const prog = path.join(home, 'app', 'bin', 'kosmos-app');
  fs.copyFileSync('/usr/bin/true', prog);
  fs.chmodSync(prog, 0o755);
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--options', 'runtime', '--entitlements', ENTITLEMENTS, '--identifier', 'kosmos-app', prog]);
  if (icnsAttr) {
    fs.mkdirSync(path.join(home, 'app', 'assets'), { recursive: true });
    const icns = path.join(home, 'app', 'assets', 'Kosmos.icns');
    fs.writeFileSync(icns, 'icns');
    execFileSync('/usr/bin/xattr', ['-wx', 'com.apple.FinderInfo', '69636e7369636e73000000000000000000000000000000000000000000000000', icns]);
  }
  return home;
}

function build(src, home) {
  const app = path.join(fs.mkdtempSync(path.join(tmpRoot, 'apps-')), 'Kosmos.app');
  const script = ['set -u', 'info() { printf "     %s\\n" "$*"; }', fnSource(src, 'build_app_bundle'), 'build_app_bundle "$1"; echo "rc=$?"'].join('\n');
  const out = execFileSync('/bin/sh', ['-c', script, 'sh', app],
    { env: { PATH: '/usr/bin:/bin', HOME: home, KOSMOS_HOME: home, PORT: '16180', MACOS_FLOOR_MAJOR: '13', MACOS_FLOOR_MINOR: '5' }, encoding: 'utf8' });
  return { app, out };
}
const verifies = (app) => spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]).status === 0;

it('#5992: the bundle build_app_bundle assembles is sealed and verifies, keeping the program\'s runtime flag', () => {
  const home = makeHome();
  const { app, out } = build(SETUP, home);
  assert.match(out, /rc=0/, 'build_app_bundle failed: ' + out);
  assert.ok(fs.existsSync(path.join(app, 'Contents', '_CodeSignature', 'CodeResources')), 'no _CodeSignature: the bundle was never sealed');
  assert.ok(verifies(app), 'the assembled bundle does not verify, so macOS would call it damaged');
  const info = spawnSync('/usr/bin/codesign', ['-dv', app], { encoding: 'utf8' }).stderr;
  assert.match(info, /flags=0x[0-9a-f]+\([^)]*runtime/, 'the hardened runtime flag was dropped: ' + info);
  assert.ok(fs.existsSync(path.join(app, 'Contents', 'Resources', 'kosmos-install.json')), 'the per-install config is missing');
  const ent = spawnSync('/usr/bin/codesign', ['-d', '--entitlements', '-', app], { encoding: 'utf8' });
  assert.match(ent.stdout + ent.stderr, /com\.apple\.security\.device\.audio-input/, 'the microphone entitlement was dropped');
});

it('#5992: an icon carrying a Finder-info attribute still gets a signed bundle (attributes are cleared first)', () => {
  const { app, out } = build(SETUP, makeHome({ icnsAttr: true }));
  assert.match(out, /rc=0/, 'one icon attribute cost the whole bundle: ' + out);
  assert.ok(fs.existsSync(path.join(app, 'Contents', 'Resources', 'Kosmos.icns')), 'the icon was not copied');
  assert.ok(verifies(app), 'the bundle does not verify');
});

it('#5992 CONTROL: without the signing step the same bundle does not verify (the defect this card is about)', () => {
  const at = SETUP.indexOf('\nbuild_app_bundle() {\n');
  const end = SETUP.indexOf('\n}\n', at);
  const body = SETUP.slice(at, end);
  const unsigned = body.replace('/usr/bin/codesign --force --sign - --preserve-metadata=entitlements,flags "$app"', 'true')
    .replace('/usr/bin/codesign --verify --deep --strict "$app"', 'true');
  assert.notEqual(unsigned, body, 'the control removed nothing: the signing lines were not found');
  const src = SETUP.slice(0, at) + unsigned + SETUP.slice(end);
  const { app, out } = build(src, makeHome());
  assert.match(out, /rc=0/, 'the unsigned control did not build: ' + out);
  assert.ok(!fs.existsSync(path.join(app, 'Contents', '_CodeSignature')), 'the control bundle was sealed anyway');
  assert.ok(!verifies(app), 'an unsealed bundle verified, so the test above proves nothing');
});
