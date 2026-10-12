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

// macOS only: codesign, ditto and stat -f run below. The Linux lane runs every root test file, so the whole file
// skips there rather than failing on a missing tool.
const MAC = process.platform === 'darwin' || 'macOS codesign, ditto and stat -f';
const it = (name, fn) => test(name, { skip: MAC === true ? false : MAC }, fn);
const SETUP = fs.readFileSync(path.join(__dirname, 'install', 'setup.sh'), 'utf8');
function fnSource(name) {
  const at = SETUP.indexOf('\n' + name + '() {\n');
  assert.notEqual(at, -1, name + ' is gone from install/setup.sh');
  const end = SETUP.indexOf('\n}\n', at);
  return SETUP.slice(at + 1, end + 3);
}
const FNS = ['bundle_is_ours', 'sealed_config_reaches', 'bundle_looks_sealed', 'sealed_serves_this_install', 'sealed_requirement', 'bundle_is_sealed', 'sealed_placeable', 'app_bundle_into'].map(fnSource).join('\n');

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

/** The account's own config (slice 1), naming `home`, in a folder of its own; run() writes one for KOSMOS_HOME unless given. */
function cfgFor(home) {
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'cfg-'));
  fs.writeFileSync(path.join(dir, 'kosmos-install.json'), JSON.stringify({ kosmosHome: home, ownerUid: process.getuid(), port: 1 }));
  return dir;
}
const REMOVE = 'SEALED_REQ="$(sealed_requirement)"; ';   // what uninstall() sets before it deletes anything

function run(env, body) {
  env = { _SEALED_SRC_OK: '', _SEALED_REQ_RUN: '', ...env };
  if (env.KOSMOS_HOME && !('INSTALL_CONFIG_DIR' in env)) env = { ...env, INSTALL_CONFIG_DIR: cfgFor(env.KOSMOS_HOME) };
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

it('#5896: with the account config written (0), the shipped sealed app is copied in and still verifies', () => {
  const home = makeHome('v1');
  const st = stageOf();
  const r = run({ KOSMOS_HOME: home, _wic_rc: '0' }, `app_bundle_into "${st}"; echo "rc=$?"`);
  assert.match(r.out, /rc=0/);
  assert.equal(built(st), false, 'it built a per-install bundle instead');
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', st]);
});

it('#5896: with the config not written (2 sandbox, 1 failed) or no sealed app shipped, the bundle is built as before', () => {
  for (const [rc, tag] of [['2', 'v1'], ['1', 'v1'], ['0', null]]) {
    const st = stageOf();
    const r = run({ KOSMOS_HOME: makeHome(tag), _wic_rc: rc }, `app_bundle_into "${st}"; echo "rc=$?"`);
    assert.match(r.out, /rc=0/);
    assert.equal(built(st), true, `wic=${rc} sealed=${!!tag}: the sealed app was used`);
  }
});

it('#5896: a shipped sealed app that does not verify is not copied (the bundle is built instead)', () => {
  const home = makeHome('v1');
  fs.appendFileSync(path.join(home, 'app', 'Kosmos.app', 'Contents', 'Info.plist'), '<!-- changed after signing -->\n');
  const st = stageOf();
  run({ KOSMOS_HOME: home, _wic_rc: '0' }, `app_bundle_into "${st}"`);
  assert.equal(built(st), true);
});

it('#5896: bundle_is_ours proves a sealed icon by our own copy\'s signature, and nothing else', () => {
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

it('#5896: a bundle that carries a per-install file is still judged by it, never by a signature', () => {
  const home = makeHome('v1');
  const icon = path.join(fs.mkdtempSync(path.join(tmpRoot, 'apps-')), 'Kosmos.app');
  execFileSync('/usr/bin/ditto', [path.join(home, 'app', 'Kosmos.app'), icon]);
  fs.mkdirSync(path.join(icon, 'Contents', 'Resources'), { recursive: true });
  fs.writeFileSync(path.join(icon, 'Contents', 'Resources', 'kosmos-install.json'), '{"kosmosHome":"/elsewhere","ownerUid":501,"port":1}');
  assert.match(run({ KOSMOS_HOME: home }, `bundle_is_ours "${icon}"; echo "rc=$?"`).out, /rc=[1-9]/, 'another install\'s per-install bundle was called ours');
});

test('#5896: uninstall checks for the shared sealed icon BEFORE the branch that removes it', () => {
  const at = SETUP.indexOf('if bundle_looks_sealed "$SYS_APP_DIR/Kosmos.app"; then');
  assert.notEqual(at, -1, 'the uninstall no longer asks whether the shared icon is the sealed one');
  const rm = SETUP.indexOf('elif bundle_is_ours "$SYS_APP_DIR/Kosmos.app" remove; then', at);
  assert.ok(rm > at && rm - at < 900, 'the sealed check is not directly before the removal branch');
  const code = SETUP.slice(at, rm).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');   // comments may say rm -rf
  assert.doesNotMatch(code, /rm -rf/, 'the sealed branch removes something');
});

it('#5896: uninstall in its real order: the requirement is read, the home is deleted, and the icon is still proven ours', () => {
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

it('#5896: residue sweeps take this account\'s own sealed leftover; a sealed proof needs this account to own the bundle', () => {
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

it('#5896: the sealed app is placed only where the app will read the config, judged for the icon\'s own folder', () => {
  const realHome = fs.mkdtempSync(path.join(tmpRoot, 'realhome-'));
  const elsewhere = fs.mkdtempSync(path.join(tmpRoot, 'awh-'));
  const dir = (n) => fs.mkdtempSync(path.join(tmpRoot, n + '-'));
  const A = dir('appdir'), S = dir('sysdir'), H = dir('homeapps'), R = dir('realapps');
  let n = 0;   // the stage sits directly in the icon's folder, as make_app's does
  const stageIn = (d) => { const st = path.join(d, '.Kosmos.app.stage.' + (++n)); fs.mkdirSync(st); return st; };
  // [env, the folder the icon lands in, built (per-install) expected]
  const cases = [
    [{ HOME: realHome }, R, false],
    [{ HOME: realHome, AGENT_WORKFORCE_HOME: realHome }, R, false],
    [{ HOME: realHome, AGENT_WORKFORCE_HOME: elsewhere }, R, true],
    [{ HOME: realHome, AGENT_WORKFORCE_HOME: elsewhere, KOSMOS_APP_DIR: A }, A, false],
    [{ HOME: realHome, AGENT_WORKFORCE_HOME: elsewhere, KOSMOS_SYS_APP_DIR: S, SYS_APP_DIR: S }, S, false],
    // the iteration-13 case: only the shared folder is sandboxed, and the icon falls back to a real home folder
    [{ HOME: realHome, AGENT_WORKFORCE_HOME: elsewhere, KOSMOS_SYS_APP_DIR: S, SYS_APP_DIR: S, HOME_APP_DIR: R }, R, true],
    [{ HOME: realHome, AGENT_WORKFORCE_HOME: elsewhere, KOSMOS_HOME_APP_DIR: H, HOME_APP_DIR: H }, H, false],
  ];
  for (const [env, folder, wantBuilt] of cases) {
    const st = stageIn(folder);
    run({ ...env, KOSMOS_HOME: makeHome('v1'), _wic_rc: '0' }, `app_bundle_into "${st}"`);
    assert.equal(built(st), wantBuilt, JSON.stringify(env) + ' into ' + path.basename(folder) + (wantBuilt ? ': sealed app placed where its app would not read the config' : ': sealed app not placed'));
  }
});

it('#5896: placement and recognition agree: a sealed icon this run places is one an uninstall in the same world recognises', () => {
  const realHome = fs.mkdtempSync(path.join(tmpRoot, 'realhome-'));
  const S = fs.mkdtempSync(path.join(tmpRoot, 'sysdir-'));
  const home = makeHome('v1');
  const env = { HOME: realHome, AGENT_WORKFORCE_HOME: fs.mkdtempSync(path.join(tmpRoot, 'awh-')), KOSMOS_SYS_APP_DIR: S, SYS_APP_DIR: S,
    KOSMOS_HOME: home, INSTALL_CONFIG_DIR: cfgFor(home) };
  const st = path.join(S, '.Kosmos.app.stage.1');
  fs.mkdirSync(st);
  run({ ...env, _wic_rc: '0' }, `app_bundle_into "${st}"`);
  assert.equal(built(st), false, 'the sealed app was not placed in the sandboxed shared folder');
  const icon = path.join(S, 'Kosmos.app');
  fs.renameSync(st, icon);
  assert.match(run(env, `${REMOVE}bundle_is_ours "${icon}" remove; echo "rc=$?"`).out, /rc=0/, 'an uninstall in the same world does not recognise the icon this run placed');
});

it('#5896: a read-only shipped app is placed writable for its owner, and still verifies', () => {
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

it('#5896: a sealed occupant of the SHARED folder is not ours to replace when this run will not place the sealed app', () => {
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
  assert.match(run({ KOSMOS_HOME: home, _wic_rc: '1', SYS_APP_DIR: sys }, `${REMOVE}bundle_is_ours "${shared}" remove; echo "rc=$?"`).out, /rc=0/, 'an uninstall removal does not depend on placement');
});

it('#5896: a sealed icon serves the install the account config names: a second install of this account never takes it', () => {
  const home = makeHome('v1');
  const icon = path.join(fs.mkdtempSync(path.join(tmpRoot, 'homeapps-')), 'Kosmos.app');
  execFileSync('/usr/bin/ditto', [path.join(home, 'app', 'Kosmos.app'), icon]);
  const other = cfgFor('/Users/a/.local/share/kosmos');   // the account's default install, not this one
  for (const mode of ['', 'anchored']) {
    assert.match(run({ KOSMOS_HOME: home, _wic_rc: '2', INSTALL_CONFIG_DIR: other }, `bundle_is_ours "${icon}" ${mode}; echo "rc=$?"`).out, /rc=[1-9]/,
      `mode '${mode}': a second install took the sealed icon that serves the account's other install`);
  }
  // Uninstall: the requirement is read only when the config names this install, so a removal is refused otherwise.
  const un = run({ KOSMOS_HOME: home, INSTALL_CONFIG_DIR: other }, [
    'SEALED_REQ=""',
    'if sealed_serves_this_install; then SEALED_REQ="$(sealed_requirement)"; fi',
    `bundle_is_ours "${icon}" remove; echo "rc=$?"`,
  ].join('\n')).out;
  assert.match(un, /rc=[1-9]/, 'another install\'s uninstall removed the sealed icon that serves the account\'s default install');
  assert.match(run({ KOSMOS_HOME: home, _wic_rc: '0' }, `bundle_is_ours "${icon}"; echo "rc=$?"`).out, /rc=0/, 'CONTROL: with the config naming this install it is ours');
  const fn = SETUP.slice(SETUP.indexOf('\nuninstall() {\n'));
  assert.ok(fn.indexOf('if sealed_serves_this_install; then SEALED_REQ=') !== -1 && fn.indexOf('if sealed_serves_this_install; then SEALED_REQ=') < fn.indexOf('rm -rf "$KOSMOS_HOME"'),
    'uninstall does not decide whether the sealed icon serves this install before it deletes anything');
});

it('#5896: the uninstall names ANY sealed Kosmos icon in the shared folder as left in place, whoever it serves', () => {
  const icon = makeBundle(path.join(fs.mkdtempSync(path.join(tmpRoot, 'apps-')), 'Kosmos.app'), 'another install');
  assert.match(run({}, `bundle_looks_sealed "${icon}"; echo "rc=$?"`).out, /rc=0/);
  const legacy = path.join(fs.mkdtempSync(path.join(tmpRoot, 'apps-')), 'Kosmos.app');
  execFileSync('/usr/bin/ditto', [icon, legacy]);
  fs.mkdirSync(path.join(legacy, 'Contents', 'Resources'), { recursive: true });
  fs.writeFileSync(path.join(legacy, 'Contents', 'Resources', 'kosmos-install.json'), '{}');
  assert.match(run({}, `bundle_looks_sealed "${legacy}"; echo "rc=$?"`).out, /rc=[1-9]/, 'a per-install bundle was called sealed');
  const link = path.join(fs.mkdtempSync(path.join(tmpRoot, 'apps-')), 'Kosmos.app');
  fs.symlinkSync(icon, link);
  assert.match(run({}, `bundle_looks_sealed "${link}"; echo "rc=$?"`).out, /rc=[1-9]/, 'a link was called a sealed icon');
});

it('#5896: "own" mode answers whether a sealed icon is this install\'s without the placement gate (the transcript line uses it)', () => {
  const home = makeHome('v1');
  const shared = path.join(fs.mkdtempSync(path.join(SYS, 'own-')), 'Kosmos.app');
  execFileSync('/usr/bin/ditto', [path.join(home, 'app', 'Kosmos.app'), shared]);
  const sys = path.dirname(shared);
  assert.match(run({ KOSMOS_HOME: home, _wic_rc: '1', SYS_APP_DIR: sys }, `bundle_is_ours "${shared}"; echo "rc=$?"`).out, /rc=[1-9]/, 'CONTROL: not placeable, it is not ours to replace');
  assert.match(run({ KOSMOS_HOME: home, _wic_rc: '1', SYS_APP_DIR: sys }, `bundle_is_ours "${shared}" own; echo "rc=$?"`).out, /rc=0/, 'this install\'s own sealed icon was not recognised as its own');
  assert.match(run({ KOSMOS_HOME: home, _wic_rc: '1', SYS_APP_DIR: sys, INSTALL_CONFIG_DIR: cfgFor('/elsewhere') }, `bundle_is_ours "${shared}" own; echo "rc=$?"`).out, /rc=[1-9]/, 'an icon serving another install was called this install\'s own');
  assert.match(SETUP, /bundle_is_ours "\$SYS_APP_DIR\/Kosmos\.app" own; then APP_OWN_SEALED=yes; fi/, 'the transcript line no longer asks in own mode');
});

// Text-only invariants: they read setup.sh and run no macOS tool, so they run on every platform (the Linux lane is
// where CI runs them).
test('#5896: setup.sh ordering and mode invariants (text only, every platform)', () => {
  const un = SETUP.slice(SETUP.indexOf('\nuninstall() {\n'));
  const del = un.indexOf('rm -rf "$KOSMOS_HOME"');
  const serves = un.indexOf('if sealed_serves_this_install; then SEALED_REQ=');
  assert.ok(serves !== -1 && del !== -1 && serves < del, 'uninstall does not read the sealed requirement before it deletes KOSMOS_HOME');
  const sweeps = SETUP.match(/^\s*if bundle_is_ours "\$_res"( anchored)?; then$/gm) || [];
  assert.equal(sweeps.length, 3, 'expected the three residue sweeps');
  assert.ok(sweeps.every((l) => l.includes(' anchored;')), 'a residue sweep does not say it is one');
  assert.doesNotMatch(SETUP, /BUNDLE_SEALED_OK/, 'a VAR=x prefix flag came back');
  const fn = fnSource('bundle_is_ours');
  assert.ok(fn.indexOf('/usr/bin/stat -f %u') !== -1 && fn.indexOf('/usr/bin/stat -f %u') < fn.indexOf('bundle_is_sealed "$1"'), 'ownership is not checked before the signature');
  assert.ok(fn.indexOf('sealed_serves_this_install') < fn.indexOf('bundle_is_sealed "$1"'), 'the config is not checked before the signature');
  assert.match(SETUP, /bundle_is_ours "\$SYS_APP_DIR\/Kosmos\.app" own; then APP_OWN_SEALED=yes; fi/, 'the transcript line no longer asks in own mode');
  assert.match(SETUP, /^SEALED_REQ=""/m, 'SEALED_REQ can be inherited');
  assert.match(SETUP, /^_SEALED_SRC_OK=""/m, 'the placement cache can be inherited');
  assert.match(SETUP, /^_SEALED_REQ_RUN=""/m, 'the requirement cache can be inherited');
});

it('#5896: with AGENT_WORKFORCE_HOME elsewhere, a sealed icon in a REAL folder is never ours (its app reads the real home\'s config)', () => {
  const home = makeHome('v1');
  const realHome = fs.mkdtempSync(path.join(tmpRoot, 'realhome-'));
  const sandboxApps = fs.mkdtempSync(path.join(tmpRoot, 'sbapps-'));
  const realApps = fs.mkdtempSync(path.join(tmpRoot, 'realapps-'));
  const inReal = path.join(realApps, 'Kosmos.app'), inSandbox = path.join(sandboxApps, 'Kosmos.app');
  for (const b of [inReal, inSandbox]) execFileSync('/usr/bin/ditto', [path.join(home, 'app', 'Kosmos.app'), b]);
  const env = { KOSMOS_HOME: home, HOME: realHome, AGENT_WORKFORCE_HOME: fs.mkdtempSync(path.join(tmpRoot, 'awh-')),
    KOSMOS_APP_DIR: sandboxApps, HOME_APP_DIR: realApps, _wic_rc: '0' };
  for (const mode of ['', 'anchored', 'own']) {
    assert.match(run(env, `bundle_is_ours "${inReal}" ${mode}; echo "rc=$?"`).out, /rc=[1-9]/, `mode '${mode}': a real-folder sealed icon was called ours under a sandbox config`);
  }
  assert.match(run(env, `${REMOVE}bundle_is_ours "${inReal}" remove; echo "rc=$?"`).out, /rc=[1-9]/, 'an uninstall under a sandbox config would remove a real-folder sealed icon');
  assert.match(run(env, `bundle_is_ours "${inSandbox}"; echo "rc=$?"`).out, /rc=0/, 'CONTROL: the icon in the sandboxed folder is ours');
});

it('#5896: a sealed copy that does not come out whole falls back to building the per-install bundle', () => {
  const home = makeHome('v1');
  const st = stageOf();
  // A stand-in ditto that writes a partial copy and fails, ahead of /usr/bin on PATH, is not reachable (the
  // function calls /usr/bin/ditto by path), so the copy is made to fail by a stage that already holds a file of
  // the bundle's top-level name as a directory's name.
  fs.writeFileSync(path.join(st, 'Contents'), 'in the way');
  const r = run({ KOSMOS_HOME: home, _wic_rc: '0' }, `app_bundle_into "${st}"; echo "rc=$?"`);
  assert.match(r.out, /rc=0/, 'a failed sealed copy ended the icon step instead of falling back');
  assert.equal(built(st), true, 'the per-install bundle was not built after the failed copy');
});
