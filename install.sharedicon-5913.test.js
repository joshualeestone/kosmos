'use strict';

/**
 * #5913: when ANOTHER account's sealed Kosmos.app holds the shared Applications spot, this install reuses it (the
 * sealed app reads the clicking account's own config) instead of making a second icon in ~/Applications, and records
 * the reuse so #5912's uninstall never strands this account (the contract agreed with Angel, 2026-10-12).
 *
 * The real functions are lifted out of install/setup.sh and run under /bin/sh, as install.sealed-app-5896.test.js
 * does, against real ad-hoc signed bundles. "Owned by another account" needs root to make, so the one owner lookup,
 * file_owner_uid, is stood in for the occupant's path only; every other check is the real code.
 *
 *   node --test install.sharedicon-5913.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const MAC = process.platform === 'darwin' || 'macOS codesign, ditto and stat -f';
const it = (name, fn) => test(name, { skip: MAC === true ? false : MAC }, fn);
const SETUP = fs.readFileSync(path.join(__dirname, 'install', 'setup.sh'), 'utf8');
function fnSource(name) {
  const at = SETUP.indexOf('\n' + name + '() {\n');
  assert.notEqual(at, -1, name + ' is gone from install/setup.sh');
  const end = SETUP.indexOf('\n}\n', at);
  return SETUP.slice(at + 1, end + 3);
}
const FNS = ['file_owner_uid', 'bundle_is_ours', 'sealed_config_reaches', 'bundle_looks_sealed', 'sealed_serves_this_install',
  'sealed_requirement', 'bundle_is_sealed', 'sealed_placeable', 'sealed_icon_reusable', 'sealed_icon_other_users',
  'sealed_icon_mark_reuse', 'sealed_icon_unmark', 'resolve_app_dir'].map(fnSource).join('\n');
const ME = String(process.getuid());

let tmpRoot;
test.before(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-sharedicon-5913-')); });
test.after(() => { fs.rmSync(tmpRoot, { recursive: true, force: true }); });

function makeBundle(dir, tag) {
  fs.mkdirSync(path.join(dir, 'Contents', 'MacOS'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Contents', 'Info.plist'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleIdentifier</key>'
    + '<string>com.chaoskosmos.kosmos</string><key>CFBundleExecutable</key><string>Kosmos</string></dict></plist>\n');
  fs.writeFileSync(path.join(dir, 'Contents', 'MacOS', 'Kosmos'), '#!/bin/sh\n# ' + tag + '\n', { mode: 0o755 });
  execFileSync('/usr/bin/codesign', ['--force', '-s', '-', dir], { stdio: 'ignore' });
  return dir;
}
/** A world: a Kosmos home shipping a sealed app, this account's config naming it, a shared folder and a home folder. */
function world() {
  const root = fs.mkdtempSync(path.join(tmpRoot, 'w-'));
  const home = path.join(root, 'kosmos-home'); fs.mkdirSync(path.join(home, 'app'), { recursive: true });
  makeBundle(path.join(home, 'app', 'Kosmos.app'), 'v1');
  const cfg = path.join(root, 'cfg'); fs.mkdirSync(cfg);
  fs.writeFileSync(path.join(cfg, 'kosmos-install.json'), JSON.stringify({ kosmosHome: home, ownerUid: process.getuid(), port: 1 }));
  const sys = path.join(root, 'shared-apps'); fs.mkdirSync(sys);
  const homeApps = path.join(root, 'home-apps'); fs.mkdirSync(homeApps);
  const users = path.join(root, 'sealed-icon-users');
  return { root, home, cfg, sys, homeApps, users, shared: path.join(sys, 'Kosmos.app') };
}
/** Put a copy of the shipped sealed app (same signature) in the shared spot. */
const occupy = (w) => execFileSync('/usr/bin/ditto', [path.join(w.home, 'app', 'Kosmos.app'), w.shared]);

/** Run `body` with the real functions; OTHER names the one path whose owner reads as another account (uid 999). */
function run(w, body, { other = '', wic = '0', extraEnv = {} } = {}) {
  const standIn = `file_owner_uid() { if [ -n "$OTHER" ] && [ "$1" = "$OTHER" ]; then echo 999; else /usr/bin/stat -f %u "$1" 2>/dev/null; fi; }`;
  const script = ['set -u', FNS, standIn,
    'APP_OTHER_OWNER=no; APP_SKIP_ICON=no; APP_SKIP_REASON=""; APP_SYS_STALE=no; APP_OWN_SEALED=no', body].join('\n');
  const env = { PATH: '/usr/bin:/bin', KOSMOS_HOME: w.home, INSTALL_CONFIG_DIR: w.cfg, SYS_APP_DIR: w.sys,
    HOME_APP_DIR: w.homeApps, SEALED_USERS_DIR: w.users, OTHER: other, _wic_rc: wic, _SEALED_SRC_OK: '', _SEALED_REQ_RUN: '', ...extraEnv };
  try { return { rc: 0, out: execFileSync('/bin/sh', ['-c', script], { env, encoding: 'utf8' }) }; }
  catch (e) { return { rc: e.status, out: String(e.stdout || '') }; }
}

it('#5913: another account\'s sealed icon in the shared spot is reused: no second icon, and the reason says so', () => {
  const w = world(); occupy(w);
  const r = run(w, 'resolve_app_dir; echo "skip=$APP_SKIP_ICON reason=$APP_SKIP_REASON dir=$APP_DIR"', { other: w.shared });
  assert.match(r.out, /skip=yes reason=shared-sealed/, 'another account\'s sealed icon was not reused: ' + r.out);
  // CONTROL: the same icon owned by THIS account is this install's own, replaced as before, never "reused".
  const own = run(w, 'resolve_app_dir; echo "skip=$APP_SKIP_ICON reason=$APP_SKIP_REASON"');
  assert.match(own.out, /skip=no reason=$/m, 'this account\'s own sealed icon was treated as another account\'s: ' + own.out);
});

it('#5913: reuse needs this run to place the sealed app (the config written where the app reads it)', () => {
  const w = world(); occupy(w);
  for (const wic of ['1', '2']) {
    const r = run(w, 'sealed_icon_reusable "$SYS_APP_DIR/Kosmos.app"; echo "rc=$?"', { other: w.shared, wic });
    assert.match(r.out, /rc=[1-9]/, `wic=${wic}: reused although this account's config was not written`);
  }
  assert.match(run(w, 'sealed_icon_reusable "$SYS_APP_DIR/Kosmos.app"; echo "rc=$?"', { other: w.shared }).out, /rc=0/, 'CONTROL: config written, not reused');
});

it('#5913: a link, a different app, or this account\'s own icon is never reused', () => {
  const w = world();
  const real = makeBundle(path.join(w.root, 'elsewhere', 'Kosmos.app'), 'v1');
  fs.symlinkSync(real, w.shared);
  assert.match(run(w, 'sealed_icon_reusable "$SYS_APP_DIR/Kosmos.app"; echo "rc=$?"', { other: w.shared }).out, /rc=[1-9]/, 'a link was reused');
  fs.unlinkSync(w.shared);
  makeBundle(w.shared, 'someone-else');   // another signature: not the app this install ships
  assert.match(run(w, 'sealed_icon_reusable "$SYS_APP_DIR/Kosmos.app"; echo "rc=$?"', { other: w.shared }).out, /rc=[1-9]/, 'a different app was reused');
  fs.rmSync(w.shared, { recursive: true }); occupy(w);
  assert.match(run(w, 'sealed_icon_reusable "$SYS_APP_DIR/Kosmos.app"; echo "rc=$?"').out, /rc=[1-9]/, 'this account\'s own icon read as another account\'s');
});

it('#5913/#5912 reader: exit 1 only when no OTHER account has a marker; every failure keeps the icon (exit 0)', () => {
  const w = world();
  const ask = () => run(w, `sealed_icon_other_users ${ME}; echo "rc=$?"`).out;
  assert.match(ask(), /rc=1/, 'folder absent must read "no other user" (a Mac with no reuse behaves as today)');
  fs.mkdirSync(w.users);
  assert.match(ask(), /rc=1/, 'an empty folder must read "no other user"');
  fs.writeFileSync(path.join(w.users, ME), '');
  assert.match(ask(), /rc=1/, 'only the owner\'s own marker must read "no other user"');
  fs.writeFileSync(path.join(w.users, '502'), '');
  assert.match(ask(), /rc=0/, 'another account\'s marker must keep the icon');
  fs.rmSync(path.join(w.users, '502'));
  fs.writeFileSync(path.join(w.users, '.hidden'), '');
  assert.match(ask(), /rc=0/, 'a dot-named marker must keep the icon too (fail safe)');
  fs.rmSync(path.join(w.users, '.hidden'));
  fs.chmodSync(w.users, 0o000);
  try { assert.match(ask(), /rc=0/, 'an unreadable folder must keep the icon'); } finally { fs.chmodSync(w.users, 0o755); }
  fs.rmSync(w.users, { recursive: true }); fs.writeFileSync(w.users, 'not a folder');
  assert.match(ask(), /rc=0/, 'a non-folder at that path must keep the icon');
});

it('#5913: the reuse marker is written in a sticky shared folder, and the uninstall takes back only its own', () => {
  const w = world();
  assert.match(run(w, 'sealed_icon_mark_reuse; echo "rc=$?"').out, /rc=0/);
  assert.ok(fs.existsSync(path.join(w.users, ME)), 'no marker for this account');
  assert.equal(fs.statSync(w.users).mode & 0o7777, 0o1777, 'the shared folder is not sticky world-writable');
  assert.match(run(w, `sealed_icon_other_users 999; echo "rc=$?"`).out, /rc=0/, 'the icon owner\'s uninstall would not see this account\'s marker');
  assert.match(run(w, 'sealed_icon_unmark; echo "rc=$?"').out, /rc=0/);
  assert.ok(!fs.existsSync(path.join(w.users, ME)), 'the uninstall did not take back its own marker');
  // Another account's marker is never removed: the file "owned by" uid 999 survives this account's unmark.
  const mine = path.join(w.users, ME);
  fs.writeFileSync(mine, '');
  assert.match(run(w, 'sealed_icon_unmark; echo "rc=$?"', { other: mine }).out, /rc=0/);
  assert.ok(fs.existsSync(mine), 'a marker owned by another account was removed');
});

test('#5913: setup.sh wiring (text only, every platform)', () => {
  // The reuse is decided inside the not-ours branch, after the own-icon check, before the divert.
  const rad = fnSource('resolve_app_dir');
  const own = rad.indexOf('APP_OWN_SEALED=yes; fi');
  const reuse = rad.indexOf('sealed_icon_reusable "$SYS_APP_DIR/Kosmos.app"');
  const divert = rad.indexOf('THE DIVERT ITSELF NEEDS THE ALIASING GUARD');
  assert.ok(own !== -1 && reuse > own && divert > reuse, 'the reuse check is not between the own-icon check and the divert');
  // The transcript says it, and the marker is written there.
  assert.match(SETUP, /if \[ "\$APP_SKIP_REASON" = "shared-sealed" \]; then[\s\S]{0,300}it opens your Kosmos too\.[\s\S]{0,200}sealed_icon_mark_reuse/, 'the reuse sentence or its marker write is gone');
  // The uninstall takes back the marker BEFORE anything else reads that folder, for the install the config names.
  const un = SETUP.indexOf('\nuninstall() {\n');
  const unmark = SETUP.indexOf('sealed_icon_unmark ||', un);
  const firstSweep = SETUP.indexOf('bundle_looks_sealed "$SYS_APP_DIR/Kosmos.app"', un);
  assert.ok(un !== -1 && unmark > un && firstSweep > unmark, 'the uninstall does not take back its marker first');
  // Sandboxed runs never touch the real /Users/Shared.
  assert.match(SETUP, /elif \[ -n "\$\{KOSMOS_SYS_APP_DIR:-\}" \]; then SEALED_USERS_DIR="\$KOSMOS_SYS_APP_DIR\/\.kosmos-sealed-icon-users"/, 'a run sandboxed by KOSMOS_SYS_APP_DIR could reach the real shared folder');
});
