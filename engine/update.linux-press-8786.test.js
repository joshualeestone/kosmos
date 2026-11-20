'use strict';
require('../test-support/tmpscope'); // kosmos#4273: this process's temp folders, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * kosmos#8786 slice 1: an installed Linux board whose systemd unit survives the press (the board runs in its own
 * unit's cgroup, and the unit's KillMode is `process`) gets the [Update] button, and the press is the same detached
 * run-setup the Mac's is. One that does not keeps #7935's command. The UNATTENDED install stays off on Linux whatever
 * the press says: canSelfInstall, which gates it, is unchanged. Runs from either OS: the platform, the install root,
 * the network and the unit reading are seams.
 *
 *   node --test engine/update.linux-press-8786.test.js
 */
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-linuxpress-'));
const update = require('./update');
const platform = require('./platform');

const NEWER = '99.0.0';
const ENV_KEYS = ['KOSMOS_UPDATE_CHANNEL', 'AGENT_WORKFORCE_UPDATE_CHANNEL', 'KOSMOS_RELEASE_BASE', 'AGENT_WORKFORCE_RELEASE_BASE'];
let saved = {};

function installedRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-linuxpressroot-'));
  fs.mkdirSync(path.join(root, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(root, 'app'), { recursive: true });
  fs.writeFileSync(path.join(root, 'runtime', 'bin', 'node'), '#!/bin/sh\n', { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'app', 'server.js'), '');
  return root;
}
const manifest = (plat, arch) => plat === 'linux'
  ? { version: NEWER, sha256: 'ab'.repeat(32), artifact: `kosmos-linux-${arch}.tar.gz`, versioned: `kosmos-${NEWER}-linux-${arch}.tar.gz`, arch }
  : { version: NEWER, sha256: 'ab'.repeat(32), artifact: 'kosmos.tar.gz', versioned: `kosmos-${NEWER}.tar.gz` };

let ROOT = null;
async function look(plat, arch, press) {
  update.resetCache();
  update.setPlatform(plat, arch);
  update.setLinuxPress(() => press);
  const root = installedRoot();
  ROOT = root;
  update.setInstalledRoot(() => root);
  update.setFetcher(async () => ({ ok: true, json: async () => manifest(plat, arch) }));
  await update.refresh();
}

test.beforeEach(() => { saved = {}; for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
test.afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  update.setPlatform(null); update.setInstalledRoot(null); update.setFetcher(null); update.setLinuxPress(null);
  update.setAutoPref(null); update.setInstallRunner(null); update.setLinuxPressReaders(null); update.resetCache();
});

test('#8786: a Linux board whose unit survives the press gets [Update], and no command', async () => {
  await look('linux', 'x64', true);
  const offer = update.installOffer();
  assert.ok(offer && offer.version === NEWER, 'no [Update] offer on a Linux board that can take the press: ' + JSON.stringify(offer));
  assert.equal(update.manualOffer(), null, 'the command was offered beside the button');
  assert.equal(update.selfInstallRefusal('linux'), null, 'the press is refused although the unit survives it');
});

test('#8786: CONTROL, the same board whose unit would not survive keeps #7935 exactly (command, no button, refusal)', async () => {
  await look('linux', 'x64', false);
  assert.equal(update.installOffer(), null, 'a button was offered on a unit whose stop would kill the installer');
  const manual = update.manualOffer();
  assert.ok(manual && manual.command === "'" + ROOT + "/bin/kosmos' update --if-newer --install", 'the command is gone: ' + JSON.stringify(manual));
  assert.ok(update.selfInstallRefusal('linux').includes(manual.command), 'the refusal lost the command');
});

test('#8786: SELF_INSTALL is unchanged, so the unattended install stays off on Linux even when the press is on', async () => {
  assert.deepEqual(platform.SELF_INSTALL, ['darwin', 'win32'], 'Linux joined SELF_INSTALL, which would also switch on automatic installs');
  update.setAutoPref(() => ({ on: true }));
  const runs = [];
  update.setInstallRunner((url) => { runs.push(url); return null; });
  await look('linux', 'x64', true);   // refresh() ends in maybeAutoInstall()
  assert.ok(update.installOffer(), 'CONTROL: the press is on, so a broken auto gate would have fired');
  assert.deepEqual(runs, [], 'a Linux look started an automatic install');
  assert.equal(update.lastAttempt(), null, 'a Linux look recorded an attempt: ' + JSON.stringify(update.lastAttempt()));
  // CONTROL for the instrument: the same look on the Mac does start one through the same runner.
  await look('darwin', 'arm64', false);
  assert.equal(runs.length, 1, 'the runner seam cannot see an automatic install at all, so the Linux zero meant nothing');
});

test('#8786: the press on Linux goes past the platform refusal to the reviewed spawn (stopped there by the test gate)', async () => {
  await look('linux', 'x64', true);
  // installRunner null: the real wiring. In a test process the live-execution gate THROWS before /bin/sh runs.
  assert.throws(() => update.beginInstall({}), (e) => Boolean(e) && e.code === 'LIVE_EXECUTION_REFUSED',
    'the Linux press did not reach the live-execution gate in front of the spawn');
  update.resetCache();
  await look('linux', 'x64', false);
  assert.throws(() => update.beginInstall({}), /cannot update itself on this platform \(linux\)/, 'CONTROL: the refusal no longer fires on a unit that would not survive');
});

test('#8786: a source checkout on Linux is offered nothing even when the unit reads right', async () => {
  await look('linux', 'x64', true);
  update.setInstalledRoot(() => null);
  assert.equal(update.installOffer(), null);
  assert.equal(update.manualOffer(), null);
  assert.equal(update.canPressUpdate('linux'), false);
});

test('#8786: the press is Linux by name: freebsd stays refused whatever the unit says', async () => {
  await look('linux', 'x64', true);
  update.setPlatform('freebsd', 'x64');
  assert.equal(update.canPressUpdate('freebsd'), false);
  assert.equal(update.installOffer(), null);
});

test('#8786: cgroupIsUnit reads the cgroup v2 line, and only an exact unit name at its end', () => {
  const mine = '0::/user.slice/user-1001.slice/user@1001.service/app.slice/kosmos-board.service\n';
  assert.equal(update.cgroupIsUnit(mine, 'kosmos-board.service'), true);
  assert.equal(update.cgroupIsUnit(mine, 'kosmos-board.1a2b3c4d.service'), false, 'another home\'s unit matched');
  assert.equal(update.cgroupIsUnit('0::/user.slice/user-1001.slice/session-3.scope\n', 'kosmos-board.service'), false, 'an ssh session matched');
  assert.equal(update.cgroupIsUnit('0::/user.slice/x/app.slice/not-kosmos-board.service\n', 'kosmos-board.service'), false, 'a suffix match passed');
  assert.equal(update.cgroupIsUnit('1:name=systemd:/app.slice/kosmos-board.service\n', 'kosmos-board.service'), false, 'a v1 line passed');
  assert.equal(update.cgroupIsUnit('', 'kosmos-board.service'), false);
  assert.equal(update.cgroupIsUnit(mine, ''), false);
});

test('#8786: the real readers say no here (no /proc on a Mac; on Linux the temp root names a unit this process is not in)', async () => {
  await look('linux', 'x64', true);
  update.setLinuxPress(null);   // the real reading: /proc/self/cgroup (absent on a Mac) and systemctl
  assert.equal(update.canPressUpdate('linux'), false, 'a test process read as a board inside its own unit');
});

/* The real comparison, through the reader seam: everything below linuxUnitTakesPress runs for real. */
const BOARD_CG = (unit) => '0::/user.slice/user-1001.slice/user@1001.service/app.slice/' + unit + '\n';
function readers({ inUnit = true, status = 0, stdout = 'process\n', calls = [] } = {}) {
  return {
    cgroup: () => (inUnit ? BOARD_CG(require('./linuxboard').boardUnitName(ROOT)) : '0::/user.slice/user-1001.slice/session-3.scope\n'),
    killMode: (unit) => { calls.push(unit); return { status, stdout }; },
  };
}
async function lookReal(r) {
  await look('linux', 'x64', true);
  update.setLinuxPress(null);
  update.setLinuxPressReaders(r);
}

test('#8786: KillMode=process inside the board unit is the only reading that offers the press', async () => {
  const calls = [];
  await lookReal(readers({ calls }));
  assert.equal(update.canPressUpdate('linux'), true, 'the reading that was measured safe on a real box was refused');
  assert.deepEqual(calls, [require('./linuxboard').boardUnitName(ROOT)], 'systemctl was asked about another unit');
  for (const [why, r] of [
    ['control-group (the measured failure)', readers({ stdout: 'control-group\n' })],
    ['mixed', readers({ stdout: 'mixed\n' })],
    ['systemctl failed', readers({ status: 1 })],
    ['systemctl gave nothing', readers({ stdout: '' })],
    ['systemctl timed out (status null)', readers({ status: null, stdout: 'process\n' })],
    ['not inside the board unit', readers({ inUnit: false })],
  ]) {
    update.setLinuxPressReaders(r);
    assert.equal(update.canPressUpdate('linux'), false, 'offered the press when ' + why);
  }
});

test('#8786: outside the board unit, systemctl is never asked', async () => {
  const calls = [];
  await lookReal(readers({ inUnit: false, calls }));
  assert.equal(update.canPressUpdate('linux'), false);
  assert.deepEqual(calls, [], 'systemctl was run for a process outside the unit');
});

test('#8786: a reader that throws reads as no press, never as a crash', async () => {
  await lookReal({ cgroup: () => { throw new Error('ENOENT'); }, killMode: () => ({ status: 0, stdout: 'process' }) });
  assert.equal(update.canPressUpdate('linux'), false);
});

test('#8786: the card trusts its five-minute reading, the press reads afresh, and one press reads once', async () => {
  const calls = [];
  let mode = 'process\n';
  await lookReal({ cgroup: readers().cgroup, killMode: (u) => { calls.push(u); return { status: 0, stdout: mode }; } });
  assert.ok(update.installOffer(), 'CONTROL: the first reading offers the button');
  assert.equal(calls.length, 1);
  mode = 'control-group\n';
  assert.ok(update.installOffer(), 'the card re-read inside its five-minute window');
  assert.equal(calls.length, 1, 'the poll ran systemctl again inside the window');
  // The press: the route's refusal, then beginInstall's. Fresh means inside a few seconds, so a reading this new
  // serves it; age the memo past that and the press must see the changed unit.
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 10 * 1000;
    assert.match(update.selfInstallRefusal('linux'), /run this in a terminal/, 'the press trusted a stale "process"');
    assert.equal(calls.length, 2, 'the press did not read afresh');
    update.selfInstallRefusal('linux');
    assert.equal(calls.length, 2, 'the second check of the same press ran systemctl again');
  } finally { Date.now = realNow; }
});
