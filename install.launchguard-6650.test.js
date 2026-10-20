'use strict';
/*
 * #6650: a sandboxed install (another KOSMOS_HOME) left three test boards as real launch agents on a release
 * Mac, respawning for 20 hours, one holding the real board off its port for three. setup.sh now refuses, before
 * it writes anything, a sandboxed install whose login job would land in the account's REAL LaunchAgents when its
 * home is a temporary folder or it would use the account's own default port. The REAL guard function is lifted out
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
let keptRoot;
test.before(() => {
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-launchguard-6650-')));
  // A home that is NOT under any temp folder, for the "kept folder" arms: inside this checkout.
  keptRoot = fs.mkdtempSync(path.join(__dirname, '.launchguard-6650-'));
});
test.after(() => {
  for (const d of [tmpRoot, keptRoot]) if (d) fs.rmSync(d, { recursive: true, force: true });
});

// Runs the guard with the account's home pinned (the seam for the directory service), and HOME as given.
function guard({ home, accountHome, kosmosHome, port = '16180', defaultPort = '16180', env = {} }) {
  const script = [
    fnSource(SETUP, '_kosmos_temp_launch_refusal'),
    'KOSMOS_HOME="$1"; _kosmos_home_default="$2/.local/share/kosmos"; PORT="$3"; _kosmos_default_port="$4"',
    '_kosmos_temp_launch_refusal; echo "rc=$?"',
  ].join('\n');
  const r = spawnSync('/bin/sh', ['-c', script, 'sh', kosmosHome, home, port, defaultPort], {
    env: { PATH: '/usr/bin:/bin', HOME: home, TMPDIR: os.tmpdir(), KOSMOS_ACCOUNT_HOME: accountHome, ...env },
    encoding: 'utf8',
  });
  const rc = (r.stdout.match(/rc=(\d+)/) || [])[1];
  return { rc, err: r.stderr };
}

const isMac = process.platform === 'darwin';

test('#6650: a temp-folder home on the real LaunchAgents is refused, naming the folder and the way through', { skip: !isMac }, () => {
  const home = fs.mkdtempSync(path.join(keptRoot, 'acct-'));
  const r = guard({ home, accountHome: home, kosmosHome: path.join(tmpRoot, 'tmp.abc', 'home'), port: '57015' });
  assert.equal(r.rc, '1', r.err);
  assert.match(r.err, /is a temporary one/);
  assert.match(r.err, /Nothing was changed/);
  assert.match(r.err, /AGENT_WORKFORCE_LAUNCH/);
  assert.match(r.err, /KOSMOS_ALLOW_TEMP_LAUNCH=1/);
});

test('#6650: the /var/folders spelling of a temp home is refused too (the incident path)', { skip: !isMac }, () => {
  const home = fs.mkdtempSync(path.join(keptRoot, 'acct-'));
  const r = guard({ home, accountHome: home, kosmosHome: '/var/folders/zz/x/T/tmp.QOwO2AIR4W/home', port: '57015' });
  assert.equal(r.rc, '1', r.err);
  assert.match(r.err, /is a temporary one/);
});

test('#6650: a kept home on the account default port is refused (it would fight the real board)', { skip: !isMac }, () => {
  const home = fs.mkdtempSync(path.join(keptRoot, 'acct-'));
  const r = guard({ home, accountHome: home, kosmosHome: path.join(keptRoot, 'walk', 'home'), port: '16180', defaultPort: '16180' });
  assert.equal(r.rc, '1', r.err);
  assert.match(r.err, /port 16180, the one this account's own Kosmos uses/);
});

test('#6650: a release walk (kept home, its own port) goes through', { skip: !isMac }, () => {
  const home = fs.mkdtempSync(path.join(keptRoot, 'acct-'));
  const r = guard({ home, accountHome: home, kosmosHome: path.join(keptRoot, 'walk', 'home'), port: '57015' });
  assert.equal(r.rc, '0', r.err);
  assert.equal(r.err, '');
});

test('#6650: a caller with its own launch folder, or the explicit opt-in, goes through', { skip: !isMac }, () => {
  const home = fs.mkdtempSync(path.join(keptRoot, 'acct-'));
  const kosmosHome = path.join(tmpRoot, 'tmp.def', 'home');
  assert.equal(guard({ home, accountHome: home, kosmosHome, env: { AGENT_WORKFORCE_LAUNCH: path.join(tmpRoot, 'launch') } }).rc, '0');
  assert.equal(guard({ home, accountHome: home, kosmosHome, env: { KOSMOS_ALLOW_TEMP_LAUNCH: '1' } }).rc, '0');
  // Only exactly 1 is the opt-in.
  assert.equal(guard({ home, accountHome: home, kosmosHome, env: { KOSMOS_ALLOW_TEMP_LAUNCH: 'yes' } }).rc, '1');
});

test('#6650: a fake HOME (a test harness) writes its own LaunchAgents, so it is not refused', { skip: !isMac }, () => {
  const account = fs.mkdtempSync(path.join(keptRoot, 'acct-'));
  const fake = fs.mkdtempSync(path.join(tmpRoot, 'fakehome-'));
  const r = guard({ home: fake, accountHome: account, kosmosHome: path.join(tmpRoot, 'tmp.ghi', 'home') });
  assert.equal(r.rc, '0', r.err);
});

test('#6650: the default home (a real install or its self-update) is never refused', { skip: !isMac }, () => {
  const home = fs.mkdtempSync(path.join(keptRoot, 'acct-'));
  const r = guard({ home, accountHome: home, kosmosHome: path.join(home, '.local', 'share', 'kosmos') });
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

test('#6650: an install let through on purpose keeps the opt-in for its own self-update', () => {
  assert.match(SETUP, /KOSMOS_ALLOW_TEMP_LAUNCH:-\}" = 1 \]; then\n\s+_extra_env_kv="\$_extra_env_kv\$\( \{ _env_kv KOSMOS_ALLOW_TEMP_LAUNCH 1;/);
});
