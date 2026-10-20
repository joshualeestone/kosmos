'use strict';
/*
 * #6650: a sandboxed install (another KOSMOS_HOME) left three test boards as real launch agents on a release
 * Mac, respawning for 20 hours, one holding the real board off its port for three. setup.sh now refuses, before
 * it writes anything, a sandboxed install whose login job would land in the account's REAL LaunchAgents when its
 * home is a temporary folder. The REAL guard function is lifted out
 * of setup.sh and run under /bin/sh with each input set, so no install runs here at all.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SETUP = fs.readFileSync(path.join(__dirname, 'install', 'setup.sh'), 'utf8');
function fnSource(src, name) {
  const at = src.indexOf('\n' + name + '() {\n');
  assert.notEqual(at, -1, name + ' is gone from install/setup.sh');
  const end = src.indexOf('\n}\n', at);
  return src.slice(at + 1, end + 3);
}

let tmpRoot;
test.before(() => { tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-launchguard-6650-'))); });
test.after(() => { if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true }); });

// A home that is NOT a temp folder. The guard compares strings and never creates or enters KOSMOS_HOME, so it
// need not exist; a fixed path keeps it kept even when this suite runs from a release cut's temp copy of the tree.
const KEPT = '/Users/launchguard-6650-nobody/kosmos-walk/home';
const ACCOUNT_HOME = '/Users/launchguard-6650-nobody';

// Runs the REAL guard with the given inputs, under set -u as setup.sh runs (set -e is off inside it there too: it
// is called as `_kosmos_temp_launch_refusal || exit 2`).
function guard({ home = ACCOUNT_HOME, kosmosHome, env = {} }) {
  const script = [
    'set -eu',
    fnSource(SETUP, '_kosmos_temp_launch_refusal'),
    'KOSMOS_HOME="$1"; _kosmos_home_default="$2/.local/share/kosmos"',
    'rc=0; _kosmos_temp_launch_refusal || rc=$?; echo "rc=$rc"',
  ].join('\n');
  const r = spawnSync('/bin/sh', ['-c', script, 'sh', kosmosHome, home], {
    env: { PATH: '/usr/bin:/bin', HOME: home, TMPDIR: os.tmpdir(), ...env },
    encoding: 'utf8',
  });
  const rc = (r.stdout.match(/rc=(\d+)/) || [])[1];
  return { rc, err: r.stderr };
}

const isMac = process.platform === 'darwin';

test('#6650: a temp-folder home is refused, naming the folder and the way through', { skip: !isMac }, () => {
  const r = guard({ kosmosHome: '/private/tmp/launchguard-6650-a/home' });
  assert.equal(r.rc, '1', r.err);
  assert.match(r.err, /is a temporary one/);
  assert.match(r.err, /Nothing was changed/);
  assert.match(r.err, /AGENT_WORKFORCE_LAUNCH/);
  assert.match(r.err, /KOSMOS_ALLOW_TEMP_LAUNCH=1/);
});

test('#6650: the /var/folders spelling of a temp home is refused too (the incident path)', { skip: !isMac }, () => {
  const r = guard({ kosmosHome: '/var/folders/zz/x/T/tmp.QOwO2AIR4W/home' });
  assert.equal(r.rc, '1', r.err);
  assert.match(r.err, /is a temporary one/);
});

test('#6650: a kept home is not refused (a person self-hosting, or a release walk)', { skip: !isMac }, () => {
  const r = guard({ kosmosHome: KEPT });
  assert.equal(r.rc, '0', r.err);
  assert.equal(r.err, '');
});

test('#6650: other spellings of a temp folder are refused: capitals, /System/Volumes/Data, a symlink into one', { skip: !isMac }, () => {
  assert.equal(guard({ kosmosHome: '/Private/Var/Folders/zz/x/T/tmp.a/home' }).rc, '1');
  assert.equal(guard({ kosmosHome: '/System/Volumes/Data/private/var/folders/zz/x/T/tmp.b/home' }).rc, '1');
  // A link in a kept folder (/Users/Shared) that points into a temp one: refused through what it resolves to.
  let kept;
  try { kept = fs.mkdtempSync('/Users/Shared/launchguard-6650-'); } catch { return; }   // no writable kept folder here
  try {
    fs.symlinkSync('/private/tmp', path.join(kept, 'scratch'));
    const r = guard({ kosmosHome: path.join(kept, 'scratch', 'tmp.c', 'home'), env: { TMPDIR: '/nonexistent-6650' } });
    assert.equal(r.rc, '1', r.err);
  } finally { fs.rmSync(kept, { recursive: true, force: true }); }
});

test('#6650: AGENT_WORKFORCE_LAUNCH set to the real LaunchAgents is no way through (it loads at next login)', { skip: !isMac }, () => {
  const home = path.join(tmpRoot, 'acct');
  fs.mkdirSync(path.join(home, 'Library', 'LaunchAgents'), { recursive: true });
  const kosmosHome = '/private/tmp/launchguard-6650-d/home';
  const r = guard({ home, kosmosHome, env: { AGENT_WORKFORCE_LAUNCH: path.join(home, 'Library', 'LaunchAgents') } });
  assert.equal(r.rc, '1', r.err);
  // A new account, where the folder does not exist yet: refused by its spelling (with or without a trailing slash).
  const fresh = path.join(tmpRoot, 'fresh-acct');
  for (const launch of [path.join(fresh, 'Library', 'LaunchAgents'), path.join(fresh, 'Library', 'LaunchAgents') + '/']) {
    assert.equal(guard({ home: fresh, kosmosHome, env: { AGENT_WORKFORCE_LAUNCH: launch } }).rc, '1', launch);
  }
});

test('#6650: a TMPDIR as broad as HOME (or above it) names no temp folder, so a kept home under it goes through', { skip: !isMac }, () => {
  assert.equal(guard({ kosmosHome: KEPT, env: { TMPDIR: ACCOUNT_HOME } }).rc, '0');
  assert.equal(guard({ kosmosHome: KEPT, env: { TMPDIR: '/' } }).rc, '0');
  assert.equal(guard({ kosmosHome: KEPT, env: { TMPDIR: '/Users' } }).rc, '0');
});

test('#6650: a home under this run\'s own TMPDIR is refused, wherever TMPDIR points', { skip: !isMac }, () => {
  // /Users/Shared is a real folder and in none of the fixed temp spellings, so only the TMPDIR arm can refuse this.
  const r = guard({ kosmosHome: '/Users/Shared/launchguard-6650-x/home', env: { TMPDIR: '/Users/Shared' } });
  assert.equal(r.rc, '1', r.err);
  assert.match(r.err, /is a temporary one/);
});

test('#6650: the /var/tmp spelling is refused too', { skip: !isMac }, () => {
  assert.equal(guard({ kosmosHome: '/var/tmp/tmp.x/home' }).rc, '1');
});

test('#6650: a release walk (kept home, its own port) goes through, saying nothing', { skip: !isMac }, () => {
  const r = guard({ kosmosHome: KEPT, env: { KOSMOS_PORT: '57015' } });
  assert.equal(r.rc, '0', r.err);
  assert.equal(r.err, '');
});

test('#6650: a caller with its own launch folder, or the explicit opt-in, goes through', { skip: !isMac }, () => {
  const kosmosHome = '/private/tmp/launchguard-6650-b/home';
  assert.equal(guard({ kosmosHome, env: { AGENT_WORKFORCE_LAUNCH: path.join(tmpRoot, 'launch') } }).rc, '0');
  assert.equal(guard({ kosmosHome, env: { KOSMOS_ALLOW_TEMP_LAUNCH: '1' } }).rc, '0');
  // Only exactly 1 is the opt-in.
  assert.equal(guard({ kosmosHome, env: { KOSMOS_ALLOW_TEMP_LAUNCH: 'yes' } }).rc, '1');
});

test('#6650: a fake HOME is still refused (it scopes the plist file, not launchd, which registers the job here)', { skip: !isMac }, () => {
  const fake = path.join(tmpRoot, 'fakehome');
  const r = guard({ home: fake, kosmosHome: '/private/tmp/launchguard-6650-g/home' });
  assert.equal(r.rc, '1', r.err);
});

test('#6650: the default home (a real install or its self-update) is never refused', { skip: !isMac }, () => {
  const r = guard({ kosmosHome: path.join(ACCOUNT_HOME, '.local', 'share', 'kosmos') });
  assert.equal(r.rc, '0', r.err);
});

test('#6650: the guard runs before preflight, so a refusal writes nothing', () => {
  const call = SETUP.indexOf('\n_kosmos_temp_launch_refusal || exit 2\n');
  assert.notEqual(call, -1, 'the guard is no longer called');
  const preflight = SETUP.indexOf('# ---- preflight ----');
  const uninstall = SETUP.indexOf('  --uninstall) uninstall ;;');
  assert.ok(uninstall > 0 && uninstall < call, 'the guard must come after --uninstall branches away');
  assert.ok(call < preflight, 'the guard must run before preflight creates anything');
});
