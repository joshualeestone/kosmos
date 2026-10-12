'use strict';

/**
 * #5896 slice 2: install/setup.sh places the SEALED Kosmos.app the build shipped ($KOSMOS_HOME/app/Kosmos.app) when
 * this install wrote the account's own config, and proves a sealed icon is ours by its signature.
 *
 * The real functions (app_bundle_into, bundle_is_sealed, bundle_is_ours) are lifted out of setup.sh and run in bash
 * against real bundles under a temporary folder, ad-hoc signed with codesign (no keychain is involved). build_app_bundle
 * is stood in by a function that leaves a marker, so the test sees which way the choice went.
 *
 *   node --test install.sealed-app-5896.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SETUP = fs.readFileSync(path.join(__dirname, 'install', 'setup.sh'), 'utf8');
function fnSource(name) {
  const at = SETUP.indexOf('\n' + name + '() {\n');
  assert.notEqual(at, -1, name + ' is gone from install/setup.sh');
  const end = SETUP.indexOf('\n}\n', at);
  return SETUP.slice(at + 1, end + 3);
}
const FNS = ['bundle_is_ours', 'bundle_is_sealed', 'app_bundle_into'].map(fnSource).join('\n');

let tmpRoot;
test.before(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-sealed-5896-')); });
test.after(() => { fs.rmSync(tmpRoot, { recursive: true, force: true }); });

/** A minimal app bundle, ad-hoc signed. `tag` changes its executable, so two tags are two different signatures. */
function makeBundle(dir, tag) {
  fs.mkdirSync(path.join(dir, 'Contents', 'MacOS'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Contents', 'Info.plist'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleIdentifier</key>'
    + '<string>com.chaoskosmos.kosmos</string><key>CFBundleExecutable</key><string>Kosmos</string></dict></plist>\n');
  fs.writeFileSync(path.join(dir, 'Contents', 'MacOS', 'Kosmos'), '#!/bin/sh\n# ' + tag + '\n', { mode: 0o755 });
  execFileSync('/usr/bin/codesign', ['--force', '-s', '-', dir], { stdio: 'ignore' });
  return dir;
}

/** A Kosmos home whose app/ holds a sealed bundle (or nothing, with tag null). */
function makeHome(tag) {
  const home = fs.mkdtempSync(path.join(tmpRoot, 'home-'));
  fs.mkdirSync(path.join(home, 'app'));
  if (tag) makeBundle(path.join(home, 'app', 'Kosmos.app'), tag);
  return home;
}

function run(env, body) {
  const script = ['set -u', 'build_app_bundle() { /bin/mkdir -p "$1/Contents"; : > "$1/Contents/BUILT"; }', FNS, body].join('\n');
  try {
    return { rc: 0, out: execFileSync('/bin/bash', ['-c', script], { env: { PATH: '/usr/bin:/bin', ...env }, encoding: 'utf8' }) };
  } catch (e) {
    return { rc: e.status, out: String(e.stdout || '') };
  }
}
const stageOf = () => { const st = path.join(fs.mkdtempSync(path.join(tmpRoot, 'apps-')), '.Kosmos.app.stage.1'); fs.mkdirSync(st); return st; };
const built = (st) => fs.existsSync(path.join(st, 'Contents', 'BUILT'));

test('#5896: with the account config written (0), the shipped sealed app is copied in and still verifies', () => {
  const home = makeHome('v1');
  const st = stageOf();
  const r = run({ KOSMOS_HOME: home, _wic_rc: '0' }, `app_bundle_into "${st}"; echo "rc=$?"`);
  assert.match(r.out, /rc=0/);
  assert.equal(built(st), false, 'it built a per-install bundle instead');
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', st]);
});

test('#5896: with the config not written (2 sandbox, 1 failed) or no sealed app shipped, the bundle is built as before', () => {
  for (const [rc, tag] of [['2', 'v1'], ['1', 'v1'], ['0', null]]) {
    const st = stageOf();
    const r = run({ KOSMOS_HOME: makeHome(tag), _wic_rc: rc }, `app_bundle_into "${st}"; echo "rc=$?"`);
    assert.match(r.out, /rc=0/);
    assert.equal(built(st), true, `wic=${rc} sealed=${!!tag}: the sealed app was used`);
  }
});

test('#5896: a shipped sealed app that does not verify is not copied (the bundle is built instead)', () => {
  const home = makeHome('v1');
  fs.appendFileSync(path.join(home, 'app', 'Kosmos.app', 'Contents', 'Info.plist'), '<!-- changed after signing -->\n');
  const st = stageOf();
  run({ KOSMOS_HOME: home, _wic_rc: '0' }, `app_bundle_into "${st}"`);
  assert.equal(built(st), true);
});

test('#5896: bundle_is_ours proves a sealed icon by our own copy\'s signature, and nothing else', () => {
  const home = makeHome('v1');
  const icon = path.join(fs.mkdtempSync(path.join(tmpRoot, 'apps-')), 'Kosmos.app');
  execFileSync('/usr/bin/ditto', [path.join(home, 'app', 'Kosmos.app'), icon]);
  const other = makeBundle(path.join(fs.mkdtempSync(path.join(tmpRoot, 'apps-')), 'Kosmos.app'), 'someone else');
  const ask = (h, b) => run({ KOSMOS_HOME: h }, `bundle_is_ours "${b}"; echo "rc=$?"`).out;
  assert.match(ask(home, icon), /rc=0/, 'our own sealed icon was not proven ours');
  assert.match(ask(home, other), /rc=[1-9]/, 'a bundle with another signature was called ours');
  assert.match(ask(makeHome(null), icon), /rc=[1-9]/, 'with no shipped copy to compare against, a sealed icon was called ours');
  fs.appendFileSync(path.join(icon, 'Contents', 'Info.plist'), '<!-- changed -->\n');
  assert.match(ask(home, icon), /rc=[1-9]/, 'a sealed icon changed after signing was called ours');
});

test('#5896: a bundle that carries a per-install file is still judged by it, never by a signature', () => {
  const home = makeHome('v1');
  const icon = path.join(fs.mkdtempSync(path.join(tmpRoot, 'apps-')), 'Kosmos.app');
  execFileSync('/usr/bin/ditto', [path.join(home, 'app', 'Kosmos.app'), icon]);
  fs.mkdirSync(path.join(icon, 'Contents', 'Resources'), { recursive: true });
  fs.writeFileSync(path.join(icon, 'Contents', 'Resources', 'kosmos-install.json'), '{"kosmosHome":"/elsewhere","ownerUid":501,"port":1}');
  assert.match(run({ KOSMOS_HOME: home }, `bundle_is_ours "${icon}"; echo "rc=$?"`).out, /rc=[1-9]/, 'another install\'s per-install bundle was called ours');
});

test('#5896: uninstall checks for the shared sealed icon BEFORE the branch that removes it', () => {
  const at = SETUP.indexOf('if bundle_is_sealed "$SYS_APP_DIR/Kosmos.app"; then');
  assert.notEqual(at, -1, 'the uninstall no longer asks whether the shared icon is the sealed one');
  const rm = SETUP.indexOf('elif bundle_is_ours "$SYS_APP_DIR/Kosmos.app"; then', at);
  assert.ok(rm > at && rm - at < 600, 'the sealed check is not directly before the removal branch');
  assert.doesNotMatch(SETUP.slice(at, rm), /rm -rf/, 'the sealed branch removes something');
});
