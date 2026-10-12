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

let tmpRoot;
test.before(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-appcfg-5896-')); });
test.after(() => { fs.rmSync(tmpRoot, { recursive: true, force: true }); });

/** Run `body` after the lifted definitions, with only the variables given (HOME always a temp folder). */
function run(env, body) {
  const script = [
    'set -u',
    '_kosmos_home_default="$(printf \'%s\' "$HOME/.local/share/kosmos" | /usr/bin/tr -s \'/\')"',
    '_kosmos_home_default="${_kosmos_home_default%/}"',
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
  run({ ...env, KOSMOS_HOME: '/sb/kosmos' }, UNINSTALL_BLOCK);
  assert.equal(JSON.parse(fs.readFileSync(cfgFile(awh), 'utf8')).kosmosHome, '/sb/other', 'it removed another install\'s config');
  // This install's own file goes, and the empty folder with it.
  run({ ...env, KOSMOS_HOME: '/sb/kosmos' }, 'write_install_config');
  run({ ...env, KOSMOS_HOME: '/sb/kosmos' }, UNINSTALL_BLOCK);
  assert.equal(fs.existsSync(cfgFile(awh)), false, 'this install\'s config survived its uninstall');
  assert.equal(fs.existsSync(path.dirname(cfgFile(awh))), false, 'the empty folder was left');
});

test('#5896: the step writes the config before the icon, and a write failure is a note, not a stop', () => {
  const at = SETUP.indexOf('step "Adding Kosmos to your Applications."');
  const next = SETUP.slice(at, at + 600);
  assert.match(next, /_wic_rc=0; write_install_config \|\| _wic_rc=\$\?/);
  assert.ok(next.indexOf('write_install_config') < next.indexOf('resolve_app_dir'), 'the config is written after the icon is decided');
});
