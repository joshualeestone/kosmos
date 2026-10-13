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
  'sealed_marker_tag', 'sealed_icon_mark_reuse', 'sealed_icon_unmark', 'resolve_app_dir'].map(fnSource).join('\n');
const ME = String(process.getuid());
/* "Another account": any uid but the one running the test. A fixed one (502, as this test had) is the runner's OWN
   uid when CI runs as a Mac's second account, and then "another account's marker" is this account's own: CI read
   rc=1 where this Mac (uid 501) read rc=0, and the reader asked as 502 with only a 502 marker gives rc=1 (measured). */
const OTHER_UID = String(Number(ME) + 1);

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

/** Run `body` with the real functions; OTHER names the one path whose owner reads as another account (OTHER_UID). */
function run(w, body, { other = '', wic = '0', extraEnv = {} } = {}) {
  const standIn = `file_owner_uid() { if [ -n "$OTHER" ] && [ "$1" = "$OTHER" ]; then echo ${OTHER_UID}; else /usr/bin/stat -f %u "$1" 2>/dev/null; fi; }`;
  const script = ['set -u', 'info() { echo "INFO $*"; }', FNS, standIn,
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
  fs.mkdirSync(w.users); fs.chmodSync(w.users, 0o1777);   // the contract trusts only a sticky folder
  assert.match(ask(), /rc=1/, 'an empty folder must read "no other user"');
  fs.writeFileSync(path.join(w.users, ME), '');
  assert.match(ask(), /rc=1/, 'only the owner\'s own marker must read "no other user"');
  fs.writeFileSync(path.join(w.users, OTHER_UID), '');
  assert.match(ask(), /rc=0/, 'another account\'s marker must keep the icon');
  fs.rmSync(path.join(w.users, OTHER_UID));
  fs.writeFileSync(path.join(w.users, '.hidden'), '');
  assert.match(ask(), /rc=0/, 'a dot-named marker must keep the icon too (fail safe)');
  fs.rmSync(path.join(w.users, '.hidden'));
  fs.writeFileSync(path.join(w.users, '.a'), '');   // review 5: a two-character dot-name counts too
  assert.match(ask(), /rc=0/, 'a two-character dot-name was skipped');
  fs.rmSync(path.join(w.users, '.a'));
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
  assert.match(run(w, `sealed_icon_other_users ${OTHER_UID}; echo "rc=$?"`).out, /rc=0/, 'the icon owner\'s uninstall would not see this account\'s marker');
  assert.match(run(w, 'sealed_icon_unmark; echo "rc=$?"').out, /rc=0/);
  assert.ok(!fs.existsSync(path.join(w.users, ME)), 'the uninstall did not take back its own marker');
  // Another account's marker is never removed: the file "owned by" OTHER_UID survives this account's unmark.
  const mine = path.join(w.users, ME);
  fs.writeFileSync(mine, '');
  assert.match(run(w, 'sealed_icon_unmark; echo "rc=$?"', { other: mine }).out, /rc=0/);
  assert.ok(fs.existsSync(mine), 'a marker owned by another account was removed');
});

/** An old-shape per-install icon whose launcher names `home` (what bundle_is_ours proves with its anchored token). */
function ownHomeIcon(dir, home) {
  fs.mkdirSync(path.join(dir, 'Contents', 'MacOS'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Contents', 'MacOS', 'Kosmos'), `#!/bin/sh\nKOSMOS_HOME="\${KOSMOS_HOME:-${home}}"\n`, { mode: 0o755 });
  return dir;
}

it('#5913 review 1: the reader keeps the icon on a folder it cannot judge', () => {
  const w = world();
  const ask = () => run(w, `sealed_icon_other_users ${ME}; echo "rc=$?"`).out;
  fs.mkdirSync(w.users, { mode: 0o755 }); fs.chmodSync(w.users, 0o755);
  assert.match(ask(), /rc=0/, 'a folder that is not sticky (1777) was trusted');
  fs.chmodSync(w.users, 0o1777);
  assert.match(ask(), /rc=1/, 'CONTROL: an empty sticky folder reads "no other user"');
  fs.rmSync(w.users, { recursive: true });
  const real = path.join(w.root, 'real-users'); fs.mkdirSync(real); fs.chmodSync(real, 0o1777);
  fs.symlinkSync(real, w.users);
  assert.match(ask(), /rc=0/, 'a folder reached through a link was trusted');
  fs.unlinkSync(w.users);
  // An absent folder under a parent this account cannot search is "cannot judge", not "absent".
  const locked = path.join(w.root, 'locked'); fs.mkdirSync(locked);
  const hidden = path.join(locked, 'users');
  fs.chmodSync(locked, 0o000);
  try {
    assert.match(run({ ...w, users: hidden }, `sealed_icon_other_users ${ME}; echo "rc=$?"`).out, /rc=0/, 'a folder hidden by an unsearchable parent read as absent');
  } finally { fs.chmodSync(locked, 0o755); }
});

it('#5913 review 1: the marker write never follows or truncates an entry someone else put at its name', () => {
  const w = world();
  fs.mkdirSync(w.users); fs.chmodSync(w.users, 0o1777);
  const victim = path.join(w.root, 'victim.txt'); fs.writeFileSync(victim, 'keep me');
  fs.symlinkSync(victim, path.join(w.users, ME));
  assert.match(run(w, 'sealed_icon_mark_reuse; echo "rc=$?"').out, /rc=[1-9]/, 'a marker was "written" through a link');
  assert.equal(fs.readFileSync(victim, 'utf8'), 'keep me', 'the link target was truncated');
  fs.unlinkSync(path.join(w.users, ME));
  assert.match(run(w, 'sealed_icon_mark_reuse; echo "rc=$?"').out, /rc=0/, 'CONTROL: a clean name is written');
  assert.match(run(w, 'sealed_icon_mark_reuse; echo "rc=$?"').out, /rc=0/, 'a second reuse (marker already there) was refused');
  // A fresh folder is created sticky with a 755 parent, whatever the umask.
  const w2 = world(); const parent = path.dirname(w2.users);
  const r = run(w2, 'umask 077; sealed_icon_mark_reuse; echo "rc=$?"', { extraEnv: { SEALED_USERS_DIR: path.join(parent, 'p', 'users') } });
  assert.match(r.out, /rc=0/);
  assert.equal(fs.statSync(path.join(parent, 'p')).mode & 0o777, 0o755, 'the parent took the umask');
  assert.equal(fs.statSync(path.join(parent, 'p', 'users')).mode & 0o7777, 0o1777, 'the folder took the umask');
});

test('#5913 review 1: a bundle carrying a per-install file is never reused (text only, by design)', () => {
  // A per-install bundle opens its own baked home, never the clicking account's. The behaviour cannot be shown with
  // ad-hoc signing: putting that file into a signed bundle breaks its signature, so bundle_is_sealed already refuses
  // it, and a mutant dropping this check survives a behavioural test for the wrong reason (measured). The check is
  // defense in depth for a Developer ID per-install bundle, pinned by its text and its order.
  const fn = fnSource('sealed_icon_reusable');
  const pin = fn.indexOf('[ ! -e "$1/Contents/Resources/kosmos-install.json" ]');
  assert.ok(pin !== -1 && pin < fn.indexOf('bundle_is_sealed "$1"'), 'the per-install refusal is gone or comes after the signature check');
});

test('#5913 review 1: every sandbox signal keeps the marker folder inside the sandbox (text only)', () => {
  for (const v of ['KOSMOS_SYS_APP_DIR', 'KOSMOS_HOME_APP_DIR', 'KOSMOS_APP_DIR']) {
    assert.match(SETUP, new RegExp('elif \\[ -n "\\$\\{' + v + ':-\\}" \\]; then SEALED_USERS_DIR="\\$' + v + '/\\.kosmos-sealed-icon-users"'), v + ' does not keep the marker folder in its sandbox');
  }
});

it('#5913 review 2: reuse fires only while the home Applications slot is empty (an own second icon is kept and updated)', () => {
  const w = world(); occupy(w);
  const slot = path.join(w.homeApps, 'Kosmos.app');
  const ask = () => run(w, 'resolve_app_dir; echo "reason=$APP_SKIP_REASON"', { other: w.shared }).out;
  assert.match(ask(), /reason=shared-sealed/, 'CONTROL: an empty slot reuses');
  ownHomeIcon(slot, w.home);
  assert.doesNotMatch(ask(), /shared-sealed/, 'reused although this install already has its own second icon');
  fs.rmSync(slot, { recursive: true });
  ownHomeIcon(slot, path.join(w.root, 'someone-else'));
  assert.doesNotMatch(ask(), /shared-sealed/, 'reused although something else is in the home slot');
  fs.rmSync(slot, { recursive: true });
  fs.symlinkSync(path.join(w.root, 'nowhere'), slot);
  assert.doesNotMatch(ask(), /shared-sealed/, 'reused although a (dangling) link is in the home slot');
});

it('#5913 review 2: the marker names its install; only that install\'s uninstall takes it back', () => {
  const w = world();
  assert.match(run(w, 'sealed_icon_mark_reuse; echo "rc=$?"').out, /rc=0/);
  // Review 3: the marker names this install by a HASH of its home, never the path (which names the account), and is
  // readable by its owner only.
  const body = fs.readFileSync(path.join(w.users, ME), 'utf8').trim();
  const want = require('node:crypto').createHash('sha256').update(w.home).digest('hex');
  assert.equal(body, want, 'the marker does not hold the hash of this install\'s home');
  assert.ok(!body.includes(w.home) && !body.includes(path.basename(w.home)), 'the marker leaks the install path');
  assert.equal(fs.statSync(path.join(w.users, ME)).mode & 0o777, 0o600, 'the marker is readable by other accounts');
  // A sandboxed uninstall (another KOSMOS_HOME) leaves the real install's marker.
  run(w, 'sealed_icon_unmark', { extraEnv: { KOSMOS_HOME: path.join(w.root, 'sandbox-home') } });
  assert.ok(fs.existsSync(path.join(w.users, ME)), 'an uninstall of another install removed this install\'s marker');
  // CONTROL: this install's own uninstall takes it back.
  run(w, 'sealed_icon_unmark');
  assert.ok(!fs.existsSync(path.join(w.users, ME)), 'this install\'s uninstall did not take back its marker');
});

it('#5913 review 2: a FIFO planted at the marker name is refused, never opened (no hang)', () => {
  const w = world();
  fs.mkdirSync(w.users); fs.chmodSync(w.users, 0o1777);
  execFileSync('/usr/bin/mkfifo', [path.join(w.users, ME)]);
  const t0 = Date.now();
  let out = '';
  try {
    out = execFileSync('/bin/sh', ['-c', ['set -u', 'info() { :; }', FNS, 'sealed_icon_mark_reuse; echo "rc=$?"'].join('\n')],
      { env: { PATH: '/usr/bin:/bin', KOSMOS_HOME: w.home, SEALED_USERS_DIR: w.users, INSTALL_CONFIG_DIR: w.cfg, SYS_APP_DIR: w.sys, HOME_APP_DIR: w.homeApps },
        encoding: 'utf8', timeout: 5000 });
  } catch (e) { out = 'TIMEOUT or error: ' + (e.signal || e.status); }
  assert.match(out, /rc=[1-9]/, 'the writer did not refuse the FIFO: ' + out);
  assert.ok(Date.now() - t0 < 5000, 'the writer hung on the FIFO');
  // Review 4: the write goes through a private temp file linked into place; none is left, refused or not.
  assert.deepEqual(fs.readdirSync(w.users).filter((n) => n.startsWith('.mark.')), [], 'a temp marker file was left behind');
  fs.unlinkSync(path.join(w.users, ME));
  assert.match(run(w, 'sealed_icon_mark_reuse; echo "rc=$?"').out, /rc=0/, 'CONTROL: a clean name is written');
  assert.deepEqual(fs.readdirSync(w.users).filter((n) => n.startsWith('.mark.')), [], 'a temp marker file was left after a success');
  // Review 5: a DIRECTORY at this account's name is refused, not "marked" by a link made inside it.
  fs.unlinkSync(path.join(w.users, ME)); fs.mkdirSync(path.join(w.users, ME));
  assert.match(run(w, 'sealed_icon_mark_reuse; echo "rc=$?"').out, /rc=[1-9]/, 'a directory at the marker name read as marked');
  assert.deepEqual(fs.readdirSync(path.join(w.users, ME)), [], 'a link was made inside the planted directory');
});

it('#5913 review 2: the reader keeps the icon when an ancestor above the parent cannot be searched', () => {
  const w = world();
  const locked = path.join(w.root, 'locked'); fs.mkdirSync(locked);
  const deep = path.join(locked, 'Kosmos', 'sealed-icon-users');   // parent "Kosmos" is absent, grandparent locked
  fs.chmodSync(locked, 0o000);
  try {
    assert.match(run({ ...w, users: deep }, `sealed_icon_other_users ${ME}; echo "rc=$?"`).out, /rc=0/, 'a folder hidden by an unsearchable grandparent read as absent');
  } finally { fs.chmodSync(locked, 0o755); }
  assert.match(run({ ...w, users: deep }, `sealed_icon_other_users ${ME}; echo "rc=$?"`).out, /rc=1/, 'CONTROL: with the grandparent searchable, the folder reads absent');
});

it('#5913 review 6: the reader keeps the icon when the nearest existing ancestor is a FILE, executable or not', () => {
  const w = world();
  const blocker = path.join(w.root, 'blocker');
  const deep = path.join(blocker, 'Kosmos', 'sealed-icon-users');
  for (const mode of [0o755, 0o644]) {
    fs.writeFileSync(blocker, '#!/bin/sh\n'); fs.chmodSync(blocker, mode);
    assert.match(run({ ...w, users: deep }, `sealed_icon_other_users ${ME}; echo "rc=$?"`).out, /rc=0/, `a file ancestor (mode ${mode.toString(8)}) read as "no other user"`);
    fs.rmSync(blocker);
  }
  fs.mkdirSync(blocker);
  assert.match(run({ ...w, users: deep }, `sealed_icon_other_users ${ME}; echo "rc=$?"`).out, /rc=1/, 'CONTROL: with a folder there, the users folder reads absent');
});

test('#5913 review 2: open and uninstall wiring (text only, every platform)', () => {
  // A reusing run opens the shared icon, gated on reuse, never on bundle_is_ours.
  assert.match(SETUP, /if \[ "\$\{APP_SKIP_REASON:-\}" = "shared-sealed" \]; then\n  _open_app="\$SYS_APP_DIR\/Kosmos\.app"\n  sealed_icon_reusable "\$_open_app" && _open_ok=yes/, 'a reusing install no longer opens the shared icon');
  assert.match(SETUP, /&& \[ "\$_open_ok" = yes \] \\/, 'the open gate no longer uses the reuse-aware check');
  assert.match(SETUP, /_board_url="\$_open_app"/, 'the open target is not the chosen app');
  // The uninstall takes back the marker after its sandbox refusal and after the icon sweep: last (merge review 2).
  const un = SETUP.indexOf('\nuninstall() {\n');
  const refusal = SETUP.indexOf('this uninstall is for a sandboxed install', un);
  const unmark = SETUP.indexOf('sealed_icon_unmark ||', un);
  const sweep = SETUP.indexOf('shared_sealed_stays "$SYS_APP_DIR/Kosmos.app"', un);   // #5912 merged: the sweep asks shared_sealed_stays
  // Merge review 2: the marker goes LAST, just before the uninstall's exit 0 (a failed uninstall keeps it).
  const exit0 = SETUP.indexOf('\n  exit 0\n}', un);
  assert.ok(refusal !== -1 && sweep > refusal && unmark > sweep && exit0 > unmark && SETUP.slice(unmark, exit0).split('\n').length <= 3,
    `uninstall order wrong (refusal ${refusal}, sweep ${sweep}, unmark ${unmark}, exit ${exit0})`);
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
  // The uninstall takes back the marker after the icon sweep, as its last act, for the install the config names.
  const un = SETUP.indexOf('\nuninstall() {\n');
  const unmark = SETUP.indexOf('sealed_icon_unmark ||', un);
  const firstSweep = SETUP.indexOf('shared_sealed_stays "$SYS_APP_DIR/Kosmos.app"', un);   // #5912 merged: the sweep asks shared_sealed_stays
  assert.ok(un !== -1 && firstSweep > un && unmark > firstSweep, 'the uninstall does not take back its marker after the icon sweep (merge review 2: last)');
  // Sandboxed runs never touch the real /Users/Shared.
  assert.match(SETUP, /elif \[ -n "\$\{KOSMOS_SYS_APP_DIR:-\}" \]; then SEALED_USERS_DIR="\$KOSMOS_SYS_APP_DIR\/\.kosmos-sealed-icon-users"/, 'a run sandboxed by KOSMOS_SYS_APP_DIR could reach the real shared folder');
});
