'use strict';

/**
 * kosmos#6781 (O04-5c): the fleet's update pause holds the installs that do not pass run-setup. install/setup.sh asks
 * itself when it updates in place (a pasted install line, a .pkg on its pinned path); run-setup, which has already
 * asked, tells the installer so; and `manifest-verify.js paused` is the form `kosmos update --if-newer` asks so a
 * connect computer's app can say "paused" (cli.update-ifnewer-4382.test.js drives that end to end).
 *
 * The installer's ask is run on its own: the function is lifted out of install/setup.sh and called by /bin/sh with
 * the variables setup.sh would have set, so no installer runs here.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const SETUP = fs.readFileSync(path.join(__dirname, 'install', 'setup.sh'), 'utf8');
const MV = path.join(__dirname, 'engine', 'manifest-verify.js');

let tmp;
test.before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-pauseall-6781-')); });
test.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

/** A coordinator /v1/meta answer on disk, as a file:// address. */
function meta(body) {
  const f = path.join(tmp, 'meta-' + crypto.randomBytes(4).toString('hex') + '.json');
  fs.writeFileSync(f, body);
  return 'file://' + f;
}

/** The installer's update_paused, exactly as install/setup.sh defines it. */
function lifted() {
  const m = SETUP.match(/\nupdate_paused\(\) \{\n[\s\S]*?\n\}\n/);
  assert.ok(m, 'install/setup.sh no longer defines update_paused() this way; re-aim this test');
  return m[0];
}

/** Runs update_paused with setup.sh's variables; true when it says paused. */
function asks(vars) {
  // setup.sh always sets KOSMOS_HOME; by default none is installed there (FRESH_INSTALL is what says one was).
  const env = { PATH: '/usr/bin:/bin', HOME: tmp, FRESH_INSTALL: 'no', KOSMOS_HOME: path.join(tmp, 'no-install-here'),
    KOSMOS_RELEASE_BASE: 'https://installkosmos.com/dist', ...vars };
  // Under setup.sh's own shell options, so a pipefail or unset-variable regression in the ask shows here.
  const r = spawnSync('/bin/sh', ['-c', 'set -eu; set -o pipefail\n' + lifted() + '\nif update_paused; then echo PAUSED; else echo NOT; fi'], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim() === 'PAUSED';
}

test('installer: an update in place is held while paused; CONTROL: not paused, a lookalike, or no answer is not', () => {
  assert.equal(asks({ KOSMOS_UPDATE_PAUSE_URL: meta('{"build":"x","updates_paused": true}') }), true);
  assert.equal(asks({ KOSMOS_UPDATE_PAUSE_URL: meta('{\n  "updates_paused": true\n}\n') }), true, 'a pretty-printed answer');
  for (const body of ['{"updates_paused": false}', '{"updates_paused": "true"}', '{"updates_paused": 1}', '{"updates_paused": truex}', '{}', '<html>', '']) {
    assert.equal(asks({ KOSMOS_UPDATE_PAUSE_URL: meta(body) }), false, body);
  }
  assert.equal(asks({ KOSMOS_UPDATE_PAUSE_URL: 'file://' + path.join(tmp, 'no-such-meta.json') }), false, 'no answer is not paused');
});

/** An installed copy at version v, as KOSMOS_HOME. */
function installedAt(v) {
  const h = fs.mkdtempSync(path.join(tmp, 'home-'));
  fs.mkdirSync(path.join(h, 'app'), { recursive: true });
  fs.writeFileSync(path.join(h, 'app', 'package.json'), JSON.stringify({ name: 'kosmos', version: v }, null, 2) + '\n');
  return h;
}

test('installer: only a NEWER version is held; a repair or reinstall of the same version, or an older one, is not', () => {
  const paused = meta('{"updates_paused": true}');
  const at = (have, target) => asks({ KOSMOS_UPDATE_PAUSE_URL: paused, KOSMOS_HOME: installedAt(have), TARGET_VERSION: target });
  assert.equal(at('1.2.0', '1.2.3'), true, 'newer: held');
  assert.equal(at('1.9.9', '1.10.0'), true, 'newer by number, not by text: held');
  assert.equal(at('1.2.3', '1.2.3'), false, 'the same version (a repair): not held');
  assert.equal(at('1.10.0', '1.9.9'), false, 'older: not held');
  assert.equal(at('1.2.3', ''), true, 'a version this run could not read: held');
  for (const target of ['latest', 'v1.2.4', '1.2', '0.1.0.9', '1..2', '1.2.']) {
    assert.equal(at('1.2.3', target), true, 'a target that is not a.b.c (' + target + '): held, never compared');
  }
  assert.equal(asks({ KOSMOS_UPDATE_PAUSE_URL: paused, KOSMOS_HOME: path.join(tmp, 'no-such-home'), TARGET_VERSION: '1.2.3' }), true,
    'an installed version that cannot be read (a broken install): held');
});

test('installer: an install whose launcher is gone but whose app is there is an update, and is held', () => {
  const paused = meta('{"updates_paused": true}');
  assert.equal(asks({ KOSMOS_UPDATE_PAUSE_URL: paused, FRESH_INSTALL: 'yes', KOSMOS_HOME: installedAt('1.2.0'), TARGET_VERSION: '1.2.3' }), true);
});

test('installer: a long answer with the flag near its start is still paused under pipefail (the reader reads to the end)', () => {
  const body = '{"updates_paused": true, "pad": "' + 'x'.repeat(60000) + '"}';
  for (let i = 0; i < 3; i++) assert.equal(asks({ KOSMOS_UPDATE_PAUSE_URL: meta(body) }), true, 'run ' + i);
});

test('installer: a first install, run-setup\'s own run, and the operator override are never held', () => {
  const paused = meta('{"updates_paused": true}');
  assert.equal(asks({ KOSMOS_UPDATE_PAUSE_URL: paused, FRESH_INSTALL: 'yes' }), false, 'a first install');
  assert.equal(asks({ KOSMOS_UPDATE_PAUSE_URL: paused, KOSMOS_UPDATE_PAUSE_ASKED: '1' }), false, 'run-setup already asked');
  assert.equal(asks({ KOSMOS_UPDATE_PAUSE_URL: paused, KOSMOS_UPDATE_IGNORE_PAUSE: '1' }), false, 'the override');
  assert.equal(asks({ KOSMOS_UPDATE_PAUSE_URL: paused }), true, 'CONTROL: the same answer, none of those, is held');
});

test('installer: with no address named, only a release from the production site asks, at the coordinator remote access uses', () => {
  // The default address is <coordinator>/v1/meta; a file:// coordinator stands in for it, a trailing slash included.
  const coord = path.join(tmp, 'coord-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(path.join(coord, 'v1'), { recursive: true });
  fs.writeFileSync(path.join(coord, 'v1', 'meta'), '{"updates_paused": true}');
  assert.equal(asks({ AGENT_WORKFORCE_TUNNEL_COORDINATOR: 'file://' + coord + '/' }), true, 'production release: asked');
  // A local copy supplies the bytes (a thumb drive, a CI tree): nothing comes from the production site, so nothing is asked.
  assert.equal(asks({ AGENT_WORKFORCE_TUNNEL_COORDINATOR: 'file://' + coord, KOSMOS_SRC: '/some/tree' }), false, 'KOSMOS_SRC asked');
  for (const base of ['file:///tmp/dist', 'http://127.0.0.1:8080/dist', 'https://installkosmos.com.evil.test/dist', 'https://staging.installkosmos.com/dist']) {
    assert.equal(asks({ AGENT_WORKFORCE_TUNNEL_COORDINATOR: 'file://' + coord, KOSMOS_RELEASE_BASE: base }), false, base + ' asked');
  }
  // The default coordinator is the same one run-setup asks (engine/manifest-verify.js).
  const mv = require('./engine/manifest-verify.js');
  assert.ok(lifted().includes('${AGENT_WORKFORCE_TUNNEL_COORDINATOR:-' + mv.PAUSE_DEFAULT_COORDINATOR + '}'));
});

test('installer: the ask runs before the update is downloaded or anything installed is changed, and a hold exits 96 saying why', () => {
  const call = SETUP.indexOf('\nif update_paused; then\n');
  assert.ok(call > 0, 'setup.sh no longer calls update_paused');
  assert.ok(SETUP.indexOf('[ -f "$KOSMOS_HOME/bin/kosmos" ] && [ -x "$KOSMOS_HOME/bin/kosmos" ] && FRESH_INSTALL=no') < call,
    'the ask must come after FRESH_INSTALL is known');
  assert.ok(call < SETUP.indexOf('\nstep "Setting up the pieces Kosmos needs."'), 'the ask must come before the downloads');
  // After the version this run installs is known (the pointer read, and a .pkg's pinned version), or every update in
  // place would read as "version unknown" and be held, a repair included.
  assert.ok(SETUP.indexOf('*.*.*) TARGET_VERSION="$KOSMOS_PINNED_VERSION" ;;') < call, 'the ask must come after TARGET_VERSION is final');
  const block = SETUP.slice(call, SETUP.indexOf('\nfi\n', call));
  assert.match(block, /exit 96/);
  assert.match(block, /Updates are paused while Kosmos checks a problem with a release/);
  // run-setup's word that it asked is not passed on to the board or anything else the installer starts.
  const after = SETUP.slice(SETUP.indexOf('\nfi\n', call));
  assert.ok(/^\nfi\n(#.*\n)*unset KOSMOS_UPDATE_PAUSE_ASKED KOSMOS_UPDATE_IGNORE_PAUSE[ \n]/.test(after), 'KOSMOS_UPDATE_PAUSE_ASKED must be unset right after the ask');
});

test('run-setup tells the installer it has already asked', () => {
  const src = fs.readFileSync(MV, 'utf8');
  const runSetup = src.slice(src.indexOf('function runSetup('), src.indexOf('\nfunction verifyTmux('));
  assert.match(runSetup, /env\.KOSMOS_UPDATE_PAUSE_ASKED = '1';/);
  assert.ok(runSetup.indexOf("env.KOSMOS_UPDATE_PAUSE_ASKED = '1';") < runSetup.indexOf("spawnSync('/bin/sh'"),
    'it must be set on the env the installer is run with');
});

test('manifest-verify.js paused: exit 0 while paused, 1 when not, on no answer, or when told to ignore', () => {
  // The form is listed where the installer looks for what an installed copy understands.
  assert.match(fs.readFileSync(MV, 'utf8'), /manifest-verify capabilities:( [a-z0-9-]+)* paused( |\s*\*\/)/);
  const env = { ...process.env };
  const run = (extra) => spawnSync(process.execPath, [MV, 'paused'], { encoding: 'utf8', env: { ...env, ...extra } }).status;
  assert.equal(run({ KOSMOS_UPDATE_PAUSE_URL: meta('{"updates_paused": true}') }), 0);
  assert.equal(run({ KOSMOS_UPDATE_PAUSE_URL: meta('{"updates_paused": false}') }), 1);
  assert.equal(run({ KOSMOS_UPDATE_PAUSE_URL: 'file://' + path.join(tmp, 'gone.json') }), 1);
  assert.equal(run({ KOSMOS_UPDATE_PAUSE_URL: meta('{"updates_paused": true}'), KOSMOS_UPDATE_IGNORE_PAUSE: '1' }), 1);
});
