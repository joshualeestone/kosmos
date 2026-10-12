'use strict';

/**
 * #5896: a sealed, notarized Kosmos.app cannot be written to after it is signed, so the installer writes the app's
 * install config into the ACCOUNT's own Library (write_install_config), and the app reads that first
 * (native-app/main.swift installConfigCandidates, pinned by --kosmos-app-mode-selftest at bundle build).
 *
 * The real functions are lifted out of install/setup.sh and run in bash with the environment each case needs, every
 * path under a temporary folder. The sandbox guard is the case that matters most: the app reads this file FIRST, so a
 * harness that moved KOSMOS_HOME but not AGENT_WORKFORCE_HOME must never write the real account's file.
 *
 *   node --test install.app-config-5896.test.js
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
const WRITE = fnSource('write_install_config');
const UNINSTALL_BLOCK = (() => {
  const at = SETUP.indexOf('  if [ -f "$INSTALL_CONFIG_DIR/kosmos-install.json" ]');
  assert.notEqual(at, -1, 'the uninstall removal of the account config is gone');
  return SETUP.slice(at, SETUP.indexOf('\n  fi\n', at) + 5);
})();
const DIR_LINE = SETUP.match(/^INSTALL_CONFIG_DIR="[^\n]+"$/m);
assert.ok(DIR_LINE, 'INSTALL_CONFIG_DIR is no longer set on one line');
// The install path's own default-home definition, lifted rather than copied, so the guard is tested against the
// definition setup.sh really uses.
const DEFAULT_LINES = SETUP.match(/^_kosmos_home_default="[^\n]+"\n_kosmos_home_default="[^\n]+"$/m);
assert.ok(DEFAULT_LINES, 'the top-level _kosmos_home_default definition moved');

let tmpRoot;
test.before(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-appcfg-5896-')); });
test.after(() => { fs.rmSync(tmpRoot, { recursive: true, force: true }); });

/** Run `body` after the lifted definitions, with only the variables given (HOME always a temp folder). */
function run(env, body) {
  const script = [
    'set -u',
    DEFAULT_LINES[0],
    DIR_LINE[0],
    WRITE,
    body,
  ].join('\n');
  const clean = { PATH: '/usr/bin:/bin', ...env };
  try {
    return { rc: 0, out: execFileSync('/bin/bash', ['-c', script], { env: clean, encoding: 'utf8' }) };
  } catch (e) {
    return { rc: e.status, out: String(e.stdout || '') };
  }
}
const cfgFile = (home) => path.join(home, 'Library', 'Application Support', 'com.chaoskosmos.kosmos', 'kosmos-install.json');

test('#5896: a sandboxed install writes the config into ITS account folder, naming its own home and port', () => {
  const home = fs.mkdtempSync(path.join(tmpRoot, 'realhome-'));
  const awh = fs.mkdtempSync(path.join(tmpRoot, 'sandboxhome-'));
  const r = run({ HOME: home, AGENT_WORKFORCE_HOME: awh, KOSMOS_HOME: '/sb/kosmos', PORT: '17001' },
    'write_install_config; echo "rc=$?"');
  assert.match(r.out, /rc=0/);
  const cfg = JSON.parse(fs.readFileSync(cfgFile(awh), 'utf8'));
  assert.equal(cfg.kosmosHome, '/sb/kosmos');
  assert.equal(cfg.port, 17001);
  assert.equal(cfg.ownerUid, process.getuid());
  assert.equal(fs.existsSync(cfgFile(home)), false, 'it wrote the real account\'s file too');
  assert.deepEqual(fs.readdirSync(path.dirname(cfgFile(awh))), ['kosmos-install.json'], 'a temporary file was left behind');
});

test('#5896: a moved KOSMOS_HOME with the real home is treated as a sandbox and writes NOTHING', () => {
  const home = fs.mkdtempSync(path.join(tmpRoot, 'realhome-'));
  const r = run({ HOME: home, KOSMOS_HOME: '/sb/kosmos', PORT: '17001' }, 'write_install_config; echo "rc=$?"');
  assert.match(r.out, /rc=2/, 'the guard did not stand down with its own code');
  assert.equal(fs.existsSync(cfgFile(home)), false, 'a sandboxed install pointed the real app at the sandbox');
});

test('#5896: the real home spelled another way (resolved symlink, doubled slash) is still the real home', () => {
  // os.tmpdir() on macOS is /var/..., a symlink to /private/var/...: two spellings of one directory, the same shape as
  // /Users/<u> and /System/Volumes/Data/Users/<u>.
  const home = fs.mkdtempSync(path.join(tmpRoot, 'realhome-'));
  for (const awh of [fs.realpathSync(home), home.replace(/\//g, '//') + '/']) {
    if (awh === home) continue;
    const r = run({ HOME: home, AGENT_WORKFORCE_HOME: awh, KOSMOS_HOME: '/sb/kosmos', PORT: '17001' },
      'write_install_config; echo "rc=$?"');
    assert.match(r.out, /rc=2/, 'AGENT_WORKFORCE_HOME=' + awh + ' names the real home and was not caught');
    assert.equal(fs.existsSync(cfgFile(home)), false, 'a sandboxed install pointed the real app at the sandbox');
  }
});

test('#5896: a write that cannot happen returns non-zero and leaves no file behind', () => {
  const awh = fs.mkdtempSync(path.join(tmpRoot, 'sandboxhome-'));
  // A FILE where the Application Support folder should be, so the folder cannot be made.
  fs.mkdirSync(path.join(awh, 'Library'));
  fs.writeFileSync(path.join(awh, 'Library', 'Application Support'), 'in the way');
  const r = run({ HOME: fs.mkdtempSync(path.join(tmpRoot, 'realhome-')), AGENT_WORKFORCE_HOME: awh,
    KOSMOS_HOME: '/sb/kosmos', PORT: '17001' }, 'write_install_config; echo "rc=$?"');
  assert.match(r.out, /rc=1/);
  assert.deepEqual(fs.readdirSync(path.join(awh, 'Library')), ['Application Support']);
  // A folder that exists but cannot be written to: the temporary file cannot be made either. Root writes anyway.
  if (process.getuid() === 0) return;
  const awh2 = fs.mkdtempSync(path.join(tmpRoot, 'sandboxhome-'));
  const dir = path.dirname(cfgFile(awh2));
  fs.mkdirSync(dir, { recursive: true });
  fs.chmodSync(dir, 0o500);
  try {
    const r2 = run({ HOME: fs.mkdtempSync(path.join(tmpRoot, 'realhome-')), AGENT_WORKFORCE_HOME: awh2,
      KOSMOS_HOME: '/sb/kosmos', PORT: '17001' }, 'write_install_config; echo "rc=$?"');
    assert.match(r2.out, /rc=1/);
    assert.deepEqual(fs.readdirSync(dir), [], 'a failed write left a file');
  } finally { fs.chmodSync(dir, 0o700); }
});

test('#5896: a home the JSON cannot carry intact is refused, not written wrong', () => {
  for (const bad of ['/sb/a"b', '/sb/a\\b', '/sb/a\tb']) {
    const awh = fs.mkdtempSync(path.join(tmpRoot, 'sandboxhome-'));
    const r = run({ HOME: fs.mkdtempSync(path.join(tmpRoot, 'realhome-')), AGENT_WORKFORCE_HOME: awh,
      KOSMOS_HOME: bad, PORT: '17001' }, 'write_install_config; echo "rc=$?"');
    assert.match(r.out, /rc=1/, JSON.stringify(bad) + ' was written');
    assert.equal(fs.existsSync(cfgFile(awh)), false);
  }
});

test('#5896: CONTROL, a real install (default KOSMOS_HOME, real home) writes the account file', () => {
  const home = fs.mkdtempSync(path.join(tmpRoot, 'realhome-'));
  const r = run({ HOME: home, KOSMOS_HOME: home + '/.local/share/kosmos', PORT: '16180' }, 'write_install_config; echo "rc=$?"');
  assert.match(r.out, /rc=0/);
  assert.equal(JSON.parse(fs.readFileSync(cfgFile(home), 'utf8')).kosmosHome, home + '/.local/share/kosmos');
});

test('#5896: uninstall removes the account config only when it names THIS install', () => {
  const awh = fs.mkdtempSync(path.join(tmpRoot, 'sandboxhome-'));
  const env = { HOME: fs.mkdtempSync(path.join(tmpRoot, 'realhome-')), AGENT_WORKFORCE_HOME: awh, PORT: '17001' };
  // Another install of the same account wrote the file: this uninstall leaves it.
  run({ ...env, KOSMOS_HOME: '/sb/other' }, 'write_install_config');
  assert.match(run({ ...env, KOSMOS_HOME: '/sb/kosmos' }, UNINSTALL_BLOCK + '\necho "rc=$?"').out, /rc=0/);
  assert.equal(JSON.parse(fs.readFileSync(cfgFile(awh), 'utf8')).kosmosHome, '/sb/other', 'it removed another install\'s config');
  // This install's own file goes, and the folder with it, even with an interrupted write's temporary file inside.
  run({ ...env, KOSMOS_HOME: '/sb/kosmos' }, 'write_install_config');
  fs.writeFileSync(path.join(path.dirname(cfgFile(awh)), '.kosmos-install.json.Ab3dE9'), '{');
  run({ ...env, KOSMOS_HOME: '/sb/kosmos' }, UNINSTALL_BLOCK);
  assert.equal(fs.existsSync(cfgFile(awh)), false, 'this install\'s config survived its uninstall');
  assert.equal(fs.existsSync(path.dirname(cfgFile(awh))), false, 'the empty folder was left');
});

test('#5896: uninstall leaves a symlink in the config\'s place, even one naming this install', () => {
  const awh = fs.mkdtempSync(path.join(tmpRoot, 'sandboxhome-'));
  const env = { HOME: fs.mkdtempSync(path.join(tmpRoot, 'realhome-')), AGENT_WORKFORCE_HOME: awh, PORT: '17001', KOSMOS_HOME: '/sb/kosmos' };
  const target = path.join(awh, 'elsewhere.json');
  fs.writeFileSync(target, '{"kosmosHome":"/sb/kosmos","ownerUid":501,"port":17001}');
  fs.mkdirSync(path.dirname(cfgFile(awh)), { recursive: true });
  fs.symlinkSync(target, cfgFile(awh));
  run(env, UNINSTALL_BLOCK);
  assert.equal(fs.lstatSync(cfgFile(awh)).isSymbolicLink(), true, 'uninstall removed a symlink');
  assert.equal(fs.existsSync(target), true);
});

test('#5896: the step writes the config before the icon, and a write failure is a note, not a stop', () => {
  const at = SETUP.indexOf('step "Adding Kosmos to your Applications."');
  const next = SETUP.slice(at, at + 600);
  assert.match(next, /_wic_rc=0; write_install_config \|\| _wic_rc=\$\?/);
  assert.ok(next.indexOf('write_install_config') < next.indexOf('resolve_app_dir'), 'the config is no longer written before the icon is decided');
});
