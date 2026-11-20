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
  assert.throws(() => update.beginInstall({}), /cannot update itself here: this board's service would stop the installer/, 'CONTROL: the refusal no longer fires on a unit that would not survive');
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

test('#8786: boardUnitInCgroup names a board unit only from the cgroup v2 line, by its exact shape', () => {
  const cg = (u) => '0::/user.slice/user-1001.slice/user@1001.service/app.slice/' + u + '\n';
  assert.equal(update.boardUnitInCgroup(cg('kosmos-board.service')), 'kosmos-board.service');
  assert.equal(update.boardUnitInCgroup(cg('kosmos-board.1a2b3c4d.service')), 'kosmos-board.1a2b3c4d.service', 'a non-default home\'s unit was not recognised');
  assert.equal(update.boardUnitInCgroup('0::/user.slice/user-1001.slice/session-3.scope\n'), null, 'an ssh session read as the board');
  assert.equal(update.boardUnitInCgroup(cg('not-kosmos-board.service')), null, 'a lookalike unit passed');
  assert.equal(update.boardUnitInCgroup(cg('kosmos-board.subzero.service')), null, 'an agent-shaped unit passed');
  assert.equal(update.boardUnitInCgroup(cg('kosmos-board.servicex')), null, 'trailing junk passed');
  assert.equal(update.boardUnitInCgroup('1:name=systemd:/app.slice/kosmos-board.service\n'), null, 'a v1 line passed');
  assert.equal(update.boardUnitInCgroup('0::/system.slice/kosmos-board.service\n'), null, 'a SYSTEM unit passed, though systemctl --user would be asked about another one');
  assert.equal(update.boardUnitInCgroup(''), null);
});

test('#8786: the real readers say no for a test process that runs in no kosmos-board unit', async (t) => {
  // An agent's shell on a Linux Kosmos box can sit in the board unit's cgroup (the board's tmux server); there the
  // real answer is legitimately yes, so this arm is about a process outside one, and says so.
  let own = '';
  try { own = fs.readFileSync('/proc/self/cgroup', 'utf8'); } catch { own = ''; }
  if (update.boardUnitInCgroup(own)) { t.skip('this test process runs inside a kosmos-board unit'); return; }
  await look('linux', 'x64', true);
  update.setLinuxPress(null);   // the real reading: /proc/self/cgroup (absent on a Mac) and systemctl
  assert.equal(update.canPressUpdate('linux'), false, 'a test process read as a board inside its own unit');
});

/* The real comparison, through the reader seam: everything below linuxUnitTakesPress runs for real. */
const BOARD_CG = (unit) => '0::/user.slice/user-1001.slice/user@1001.service/app.slice/' + unit + '\n';
function readers({ inUnit = true, status = 0, stdout = 'process\n', calls = [], unitName = 'kosmos-board.service' } = {}) {
  return {
    cgroup: () => (inUnit ? BOARD_CG(unitName) : '0::/user.slice/user-1001.slice/session-3.scope\n'),
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
  assert.deepEqual(calls, ['kosmos-board.service'], 'systemctl was asked about another unit');
  // A non-default home's board: the unit comes from the cgroup line, whatever this board calls its home.
  const calls2 = [];
  update.setLinuxPressReaders(readers({ calls: calls2, unitName: 'kosmos-board.1a2b3c4d.service' }));
  assert.equal(update.canPressUpdate('linux'), true, 'a non-default home\'s board was refused');
  assert.deepEqual(calls2, ['kosmos-board.1a2b3c4d.service'], 'systemctl was not asked about the unit the cgroup names');
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

test('#8786: a systemctl that gave no answer is asked again after 30 s, not five minutes', async () => {
  let status = 1;
  const calls = [];
  await lookReal({ cgroup: readers().cgroup, killMode: (u) => { calls.push(u); return { status, stdout: status === 0 ? 'process\n' : '' }; } });
  assert.equal(update.manualOffer() !== null, true, 'CONTROL: a failed reading keeps the command');
  assert.equal(calls.length, 1);
  status = 0;
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 10 * 1000;
    assert.equal(update.installOffer(), null, 'the failed reading was dropped inside 30 s');
    assert.equal(calls.length, 1);
    Date.now = () => realNow() + 31 * 1000;
    assert.ok(update.installOffer(), 'the failed reading was kept past 30 s');
    assert.equal(calls.length, 2);
    // CONTROL: an ANSWERED "no" (control-group) is kept for the full window.
    update.setLinuxPressReaders({ cgroup: readers().cgroup, killMode: (u) => { calls.push(u); return { status: 0, stdout: 'control-group\n' }; } });
    assert.equal(update.installOffer(), null);
    const n = calls.length;
    Date.now = () => realNow() + 31 * 1000 + 60 * 1000;
    update.installOffer();
    assert.equal(calls.length, n, 'an answered "no" was re-asked inside five minutes');
  } finally { Date.now = realNow; }
});

test('#8786: the Linux refusal says why (the service), and gives the command', async () => {
  await look('linux', 'x64', false);
  const said = update.selfInstallRefusal('linux');
  assert.match(said, /this board's service would stop the installer partway through/);
  assert.ok(said.endsWith(update.manualOffer().command), 'the command is not the refusal\'s last words: ' + said);
  assert.doesNotMatch(said, /on this platform/, 'it still says Linux can never update itself');
});

test('#8786: a board with nothing on offer never asks systemd', async () => {
  const calls = [];
  await lookReal(readers({ calls }));
  update.setFetcher(async () => ({ ok: true, json: async () => ({ ...manifest('linux', 'x64'), version: '0.0.1' }) }));
  update.resetCache();
  update.setLinuxPressReaders(readers({ calls }));
  await update.refresh();
  assert.equal(update.available(), null, 'CONTROL: the look still offers something');
  assert.equal(update.installOffer(), null);
  assert.equal(update.manualOffer(), null);
  assert.deepEqual(calls, [], 'the poll ran systemctl with no update on offer');
});

test('#8786: a systemctl that timed out is not re-asked every 30 s', async () => {
  const calls = [];
  await lookReal({ cgroup: readers().cgroup, killMode: (u) => { calls.push(u); return { status: null, error: Object.assign(new Error('spawnSync systemctl ETIMEDOUT'), { code: 'ETIMEDOUT' }) }; } });
  assert.equal(update.installOffer(), null);
  assert.equal(calls.length, 1);
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 60 * 1000;
    update.installOffer();
    assert.equal(calls.length, 1, 'a hung user manager was asked again inside five minutes');
  } finally { Date.now = realNow; }
});

test('#8786: a press while `kosmos update` is installing (a fresh marker this board did not write) is refused', async () => {
  await look('linux', 'x64', true);
  assert.equal(update.selfInstallRefusal('linux'), null, 'CONTROL: no marker, the press is taken');
  fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
  const marker = path.join(ROOT, 'logs', 'install.started');
  fs.writeFileSync(marker, new Date().toISOString() + '\n');
  assert.equal(update.selfInstallRefusal('linux'), 'an update is already being installed on this computer');
  assert.throws(() => update.beginInstall({}), /already being installed/, 'beginInstall started a second installer');
  // An old marker (an interrupted run, over 30 minutes) does not hold the press for good.
  const old = (Date.now() - 31 * 60 * 1000) / 1000;
  fs.utimesSync(marker, old, old);
  assert.equal(update.selfInstallRefusal('linux'), null, 'a stale marker refused the press');
});
