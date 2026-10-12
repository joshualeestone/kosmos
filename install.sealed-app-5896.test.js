'use strict';

/**
 * #5896 slice 2: install/setup.sh places the SEALED Kosmos.app the build shipped ($KOSMOS_HOME/app/Kosmos.app) when
 * this install wrote the account's own config, and proves a sealed icon is ours by its signature.
 *
 * The real functions (app_bundle_into, sealed_placeable, bundle_is_sealed, bundle_is_ours) are lifted out of setup.sh and run under /bin/sh
 * against real bundles under a temporary folder, ad-hoc signed with codesign (no keychain is involved). build_app_bundle
 * is stood in by a function that leaves a marker, so the test sees which way the choice went.
 *
 * ⚠️ LIMIT: every bundle here is ad-hoc signed, whose designated requirement is its exact cdhash, so "ours" here
 * means "byte-identical to the shipped copy". The case the design exists for, an icon from the PREVIOUS version
 * (another cdhash, the same Developer ID team requirement) being recognised and replaced, needs a Developer ID
 * signature and is not exercised (the plan lists it under Not run). For the same reason a local build signed ad-hoc
 * (KOSMOS_CODESIGN_ID=-) never recognises an older icon and diverts the upgrade.
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
const FNS = ['bundle_is_ours', 'sealed_requirement', 'bundle_is_sealed', 'sealed_placeable', 'app_bundle_into'].map(fnSource).join('\n');

let tmpRoot, SYS;   // SYS: the stand-in for the shared /Applications (setup.sh's SYS_APP_DIR)
test.before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-sealed-5896-'));
  SYS = fs.mkdtempSync(path.join(tmpRoot, 'shared-apps-'));
});
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
    // /bin/sh, the shell the installer runs under (bash in POSIX mode on macOS), where a VAR=x prefix on a function
    // call outlives the call: a test under /bin/bash could not see that.
    return { rc: 0, out: execFileSync('/bin/sh', ['-c', script], { env: { PATH: '/usr/bin:/bin', SYS_APP_DIR: SYS, ...env }, encoding: 'utf8' }) };
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
  const ask = (h, b) => run({ KOSMOS_HOME: h, _wic_rc: '0' }, `bundle_is_ours "${b}"; echo "rc=$?"`).out;
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
  const at = SETUP.indexOf('if [ ! -L "$SYS_APP_DIR/Kosmos.app" ] && bundle_is_sealed "$SYS_APP_DIR/Kosmos.app"; then');
  assert.notEqual(at, -1, 'the uninstall no longer asks whether the shared icon is the sealed one');
  const rm = SETUP.indexOf('elif bundle_is_ours "$SYS_APP_DIR/Kosmos.app" remove; then', at);
  assert.ok(rm > at && rm - at < 600, 'the sealed check is not directly before the removal branch');
  assert.doesNotMatch(SETUP.slice(at, rm), /rm -rf/, 'the sealed branch removes something');
});

test('#5896: uninstall in its real order: the requirement is read, the home is deleted, and the icon is still proven ours', () => {
  const home = makeHome('v1');
  const icon = path.join(fs.mkdtempSync(path.join(tmpRoot, 'apps-')), 'Kosmos.app');
  execFileSync('/usr/bin/ditto', [path.join(home, 'app', 'Kosmos.app'), icon]);
  const order = (capture) => run({ KOSMOS_HOME: home }, [
    capture ? 'SEALED_REQ="$(sealed_requirement 2>/dev/null)" || SEALED_REQ=""' : 'SEALED_REQ=""',
    `/bin/mv "${home}" "${home}.gone"`,   // the uninstall's rm -rf of KOSMOS_HOME, kept reversible here
    `bundle_is_ours "${icon}" remove; echo "rc=$?"`,
    `/bin/mv "${home}.gone" "${home}"`,
  ].join('\n')).out;
  assert.match(order(true), /rc=0/, 'with the requirement read first, the sealed icon was not proven ours after the home went');
  assert.match(order(false), /rc=[1-9]/, 'CONTROL: without reading it first, the deleted home should leave nothing to prove against');
  const un = SETUP.slice(SETUP.indexOf('\nuninstall() {\n'));
  const cap = un.indexOf('SEALED_REQ="$(sealed_requirement');
  const del = un.indexOf('rm -rf "$KOSMOS_HOME"');
  assert.ok(cap !== -1 && del !== -1 && cap < del, 'uninstall does not read the requirement before it deletes KOSMOS_HOME');
});

test('#5896: residue sweeps take this account\'s own sealed leftover; a sealed proof needs this account to own the bundle', () => {
  const home = makeHome('v1');
  const res = path.join(SYS, '.Kosmos.app.old.123');
  execFileSync('/usr/bin/ditto', [path.join(home, 'app', 'Kosmos.app'), res]);
  assert.match(run({ KOSMOS_HOME: home }, `bundle_is_ours "${res}" anchored; echo "rc=$?"`).out, /rc=0/, 'this account\'s own sealed aside was not cleanable');
  // The mode is an argument, so nothing outlives the call: a later plain ask still answers for itself.
  assert.match(run({ KOSMOS_HOME: home, _wic_rc: '0' }, `bundle_is_ours "${res}" anchored; bundle_is_ours "${res}"; echo "rc=$?"`).out, /rc=0/, 'the residue mode leaked into a later call');
  const sweeps = SETUP.match(/^\s*if bundle_is_ours "\$_res"( anchored)?; then$/gm) || [];
  assert.equal(sweeps.length, 3, 'expected the three residue sweeps');
  assert.ok(sweeps.every((l) => l.includes(' anchored;')), 'a residue sweep does not say it is one: ' + sweeps.join(' | '));
  assert.doesNotMatch(SETUP, /BUNDLE_SEALED_OK/, 'a VAR=x prefix flag came back');
  // Another account's sealed bundle cannot be made here without root, so the ownership rule is pinned by its text.
  const fn = fnSource('bundle_is_ours');
  assert.match(fn, /\[ "\$\(\/usr\/bin\/stat -f %u "\$1" 2>\/dev\/null\)" = "\$\(\/usr\/bin\/id -u\)" \] \|\| return 1/, 'the sealed proof no longer requires this account to own the bundle');
  assert.ok(fn.indexOf('/usr/bin/stat -f %u') < fn.indexOf('bundle_is_sealed "$1"'), 'ownership is not checked before the signature');
});

test('#5896: the sealed app is placed only where the app will read the config (AGENT_WORKFORCE_HOME)', () => {
  const realHome = fs.mkdtempSync(path.join(tmpRoot, 'realhome-'));
  const elsewhere = fs.mkdtempSync(path.join(tmpRoot, 'awh-'));
  const cases = [
    [{ HOME: realHome }, false],
    [{ HOME: realHome, AGENT_WORKFORCE_HOME: realHome }, false],
    [{ HOME: realHome, AGENT_WORKFORCE_HOME: elsewhere }, true],
    [{ HOME: realHome, AGENT_WORKFORCE_HOME: elsewhere, KOSMOS_APP_DIR: '/sb/apps' }, false],
  ];
  for (const [env, wantBuilt] of cases) {
    const st = stageOf();
    run({ ...env, KOSMOS_HOME: makeHome('v1'), _wic_rc: '0' }, `app_bundle_into "${st}"`);
    assert.equal(built(st), wantBuilt, JSON.stringify(env) + (wantBuilt ? ': the sealed app was placed where the app would not read the config' : ': the sealed app was not placed'));
  }
});

test('#5896: a read-only shipped app is placed writable for its owner, and still verifies', () => {
  const home = makeHome('v1');
  execFileSync('/bin/chmod', ['-R', 'a-w', path.join(home, 'app', 'Kosmos.app')]);
  const st = stageOf();
  try {
    run({ KOSMOS_HOME: home, _wic_rc: '0' }, `app_bundle_into "${st}"`);
    assert.equal(built(st), false);
    assert.ok(fs.statSync(path.join(st, 'Contents')).mode & 0o200, 'the placed icon is not writable, so it could not be replaced or removed later');
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', st]);
  } finally {
    execFileSync('/bin/chmod', ['-R', 'u+w', path.join(home, 'app', 'Kosmos.app')]);
  }
});

test('#5896: a sealed occupant of the SHARED folder is not ours to replace when this run will not place the sealed app', () => {
  const home = makeHome('v1');
  const shared = path.join(fs.mkdtempSync(path.join(SYS, 'run-')), 'Kosmos.app');
  const sys = path.dirname(shared);
  execFileSync('/usr/bin/ditto', [path.join(home, 'app', 'Kosmos.app'), shared]);
  const own = path.join(fs.mkdtempSync(path.join(tmpRoot, 'homeapps-')), 'Kosmos.app');
  execFileSync('/usr/bin/ditto', [path.join(home, 'app', 'Kosmos.app'), own]);
  for (const rc of ['1', '2']) {
    assert.match(run({ KOSMOS_HOME: home, _wic_rc: rc, SYS_APP_DIR: sys }, `bundle_is_ours "${shared}"; echo "rc=$?"`).out, /rc=[1-9]/,
      `wic=${rc}: the shared sealed icon was taken while a per-install bundle would replace it`);
    assert.match(run({ KOSMOS_HOME: home, _wic_rc: rc, SYS_APP_DIR: sys }, `bundle_is_ours "${own}"; echo "rc=$?"`).out, /rc=0/,
      `wic=${rc}: this account's own sealed icon in its own folder was called foreign`);
  }
  assert.match(run({ KOSMOS_HOME: home, _wic_rc: '0', SYS_APP_DIR: sys }, `bundle_is_ours "${shared}"; echo "rc=$?"`).out, /rc=0/, 'CONTROL: placing the sealed app too, it is ours to replace');
  assert.match(run({ KOSMOS_HOME: home, _wic_rc: '1', SYS_APP_DIR: sys }, `bundle_is_ours "${shared}" remove; echo "rc=$?"`).out, /rc=0/, 'an uninstall removal does not depend on placement');
});
