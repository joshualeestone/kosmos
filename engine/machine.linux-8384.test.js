'use strict';

/**
 * kosmos#8384: Settings > Computer on Linux reads Linux's own answers to the two questions the Mac rows answer.
 *
 *   1. Do agents come back after a restart? The board's systemd user unit (there, switched on) and linger.
 *   2. Will the computer sleep and stop the agents? logind's IdleAction and lid switch, and GNOME's automatic
 *      suspend while GNOME's power service runs. sleepGate answers from the same reading, so /api/sleep-status never
 *      runs pmset on Linux (a Linux board does not walk the wizard's sleep step, #5877).
 *
 * Every arm of both rows, the readers through their seams (a fake runner, a temp unit folder, opts.hasLid), and
 * that every command they run is a look, never a change. No real systemctl, loginctl, busctl or gsettings runs.
 *
 *   node --test engine/machine.linux-8384.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const machine = require('./machine');

const { STATE } = machine;

/* ---------------------------------------------------------------------------
   1. The restart row
   --------------------------------------------------------------------------- */

const row = (reading) => machine.linuxBoardAutostartCheck(reading);
const BUNDLE = '/home/p/.local/share/kosmos';

test('restart row: every reading has exactly one honest answer', () => {
  const cases = [
    [{ unitFile: null }, STATE.UNKNOWN, /could not check whether Kosmos starts by itself/, /could not read the folder/],
    [{ unitFile: false, installed: null }, STATE.OK, /running from source/, /started by hand/],
    [{ unitFile: false, installed: BUNDLE }, STATE.ATTENTION, /will not start by itself/, /missing.*Reinstalling Kosmos puts it back/],
    [{ unitFile: true, unitState: null, installed: BUNDLE }, STATE.UNKNOWN, /could not check/, /did not answer/],
    [{ unitFile: true, unitState: 'masked', installed: BUNDLE }, STATE.ATTENTION, /will not start by itself/, /blocked.*\(masked\)/],
    [{ unitFile: true, unitState: 'disabled', installed: BUNDLE }, STATE.ATTENTION, /will not start by itself/, /switched off/],
    [{ unitFile: true, unitState: 'enabled', linger: true, installed: BUNDLE }, STATE.OK, /starts itself when this computer starts/, /nobody logged in/],
    [{ unitFile: true, unitState: 'enabled', linger: false, installed: BUNDLE }, STATE.ATTENTION, /stops when you log out/, /starts when you log in/],
    [{ unitFile: true, unitState: 'enabled', linger: undefined, installed: BUNDLE }, STATE.UNKNOWN, /keeps running when you log out/, /switched on, so it starts when you log in/],
  ];
  for (const [reading, state, title, detail] of cases) {
    const r = row(reading);
    const label = JSON.stringify(reading);
    assert.equal(r.key, 'autostart', label);
    assert.equal(r.state, state, label);
    assert.match(r.title, title, label);
    assert.match(r.detail, detail, label);
    assert.ok(!/macOS|System Settings|login job|launchd/i.test(r.title + r.detail), 'no Mac words on Linux: ' + label);
  }
});

test('restart row: only linger off carries the admin command, and it is the read-only-safe enable-linger', () => {
  const off = row({ unitFile: true, unitState: 'enabled', linger: false, installed: BUNDLE });
  assert.match(off.admin, /loginctl enable-linger$/);
  for (const r of [
    { unitFile: true, unitState: 'enabled', linger: true, installed: BUNDLE },
    { unitFile: true, unitState: 'disabled', installed: BUNDLE },
    { unitFile: false, installed: BUNDLE },
  ]) assert.equal(row(r).admin, undefined, JSON.stringify(r));
});

test('restart row: an enabled-runtime unit counts as switched on, masked-runtime as masked', () => {
  assert.equal(row({ unitFile: true, unitState: 'enabled-runtime', linger: true, installed: BUNDLE }).state, STATE.OK);
  assert.match(row({ unitFile: true, unitState: 'masked-runtime', installed: BUNDLE }).detail, /masked/);
});

test('boardAutostartCheck on linux takes the Linux arm (not null, as before #8384)', () => {
  const r = machine.boardAutostartCheck(() => ({ ok: false }), { platform: 'linux',
    linuxBoard: { unitFile: true, unitState: 'enabled', linger: true, installed: BUNDLE } });
  assert.equal(r.state, STATE.OK);
  assert.match(r.title, /starts itself when this computer starts/);
});

/* The reader, through a temp unit folder and a fake runner. */
function withUnitDir(withFile, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-8384-units-'));
  const prev = process.env.AGENT_WORKFORCE_SYSTEMD_DIR;
  process.env.AGENT_WORKFORCE_SYSTEMD_DIR = dir;
  try {
    if (withFile) fs.writeFileSync(path.join(dir, require('./linuxboard').boardUnitName()), '[Unit]\n');
    return fn(dir);
  } finally {
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_SYSTEMD_DIR; else process.env.AGENT_WORKFORCE_SYSTEMD_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('restart reader: reads the unit state and linger, and runs only looks', () => {
  const asked = [];
  const runner = (cmd, args) => {
    asked.push([cmd, ...args]);
    if (cmd === 'systemctl') return { ok: true, stdout: 'UnitFileState=enabled\n' };
    if (cmd === 'loginctl') return { ok: true, stdout: 'Linger=no\n' };
    return { ok: false };
  };
  const got = withUnitDir(true, () => machine.readLinuxBoardAutostart(runner, { installedRoot: BUNDLE }));
  assert.deepEqual(got, { unitFile: true, unitState: 'enabled', linger: false, installed: BUNDLE });
  assert.equal(row(got).state, STATE.ATTENTION, 'enabled with linger off is the log-out warning');
  for (const a of asked) {
    assert.ok((a[0] === 'systemctl' && a[2] === 'show') || (a[0] === 'loginctl' && a[1] === 'show-user'),
      'a Settings read must change nothing: ' + a.join(' '));
  }
  assert.ok(asked.some((a) => a[0] === 'loginctl'), 'control: linger was asked of loginctl (logind\'s file is not read in a test)');
});

test('restart reader: no unit file asks systemd nothing; an unreadable answer is null, not a guess', () => {
  const asked = [];
  const runner = (cmd, args) => { asked.push(cmd); return { ok: true, stdout: 'something else\n' }; };
  const none = withUnitDir(false, () => machine.readLinuxBoardAutostart(runner, { installedRoot: null, lingerOn: true }));
  assert.equal(none.unitFile, false);
  assert.equal(none.unitState, null);
  assert.ok(!asked.includes('systemctl'), 'no unit, no systemctl');
  const odd = withUnitDir(true, () => machine.readLinuxBoardAutostart(runner, { installedRoot: BUNDLE, lingerOn: true }));
  assert.equal(odd.unitState, null, 'a reply with no UnitFileState line is no reading');
  assert.equal(row(odd).state, STATE.UNKNOWN);
});

test('restart reader: a test with no unit folder of its own never reads the host\'s', () => {
  const prevS = process.env.AGENT_WORKFORCE_SYSTEMD_DIR, prevL = process.env.AGENT_WORKFORCE_LAUNCH;
  delete process.env.AGENT_WORKFORCE_SYSTEMD_DIR; delete process.env.AGENT_WORKFORCE_LAUNCH;
  const asked = [];
  try {
    const got = machine.readLinuxBoardAutostart((c) => { asked.push(c); return { ok: true, stdout: 'UnitFileState=enabled\n' }; }, {});
    assert.equal(got.unitFile, null);
    assert.deepEqual(asked, []);
  } finally {
    if (prevS !== undefined) process.env.AGENT_WORKFORCE_SYSTEMD_DIR = prevS;
    if (prevL !== undefined) process.env.AGENT_WORKFORCE_LAUNCH = prevL;
  }
});

/* ---------------------------------------------------------------------------
   2. The sleep row
   --------------------------------------------------------------------------- */

const sleep = (reading) => machine.linuxSleepCheck(reading);
const QUIET_IDLE = { action: 'ignore', minutes: null };

test('sleep row: nothing read is no row at all (kosmos#8375), never a standing could-not-check', () => {
  assert.equal(sleep({ idle: null, lid: null, gnome: null }), null);
  assert.equal(sleep(null), null);
});

test('sleep row: each setting that stops the agents is named, plugged-in ones as ATTENTION', () => {
  const cases = [
    [{ idle: { action: 'suspend', minutes: 30 } }, /After 30 minutes with nobody using it, this computer goes to sleep \(logind's IdleAction\)/],
    [{ idle: { action: 'poweroff', minutes: 1 } }, /After 1 minute .* turns off/],
    [{ idle: QUIET_IDLE, gnome: { ac: 'suspend', acMinutes: 20, battery: 'nothing', batteryMinutes: null } }, /plugged in, the desktop puts it to sleep after 20 minutes .*Automatic Suspend/],
    [{ idle: QUIET_IDLE, lid: { ac: 'suspend', battery: 'suspend' } }, /When the lid closes, this computer goes to sleep, even while it is plugged in/],
  ];
  for (const [reading, words] of cases) {
    const r = sleep(reading);
    assert.equal(r.key, 'sleep');
    assert.equal(r.state, STATE.ATTENTION, JSON.stringify(reading));
    assert.equal(r.battOnly, undefined, 'plugged-in findings are not battery-only: ' + JSON.stringify(reading));
    assert.match(r.title, /can go to sleep on its own/);
    assert.match(r.detail, words);
    assert.match(r.detail, /Power settings.*\/etc\/systemd\/logind\.conf/, 'it says where each part is changed');
    assert.equal(r.settings, undefined, 'no "Open sleep settings" button: that opens macOS\'s pane');
  }
});

test('sleep row: findings only on battery are battOnly, as the Mac row\'s laptop case', () => {
  for (const reading of [
    { idle: QUIET_IDLE, lid: { ac: 'ignore', battery: 'suspend' } },
    { idle: QUIET_IDLE, gnome: { ac: 'nothing', acMinutes: null, battery: 'suspend', batteryMinutes: 15 } },
  ]) {
    const r = sleep(reading);
    assert.equal(r.state, STATE.ATTENTION, JSON.stringify(reading));
    assert.equal(r.battOnly, true, JSON.stringify(reading));
    assert.match(r.title, /on battery/);
    assert.match(r.detail, /Plugged in and open, it keeps working/);
  }
  // Control: one plugged-in finding beside a battery one makes the whole row plugged-in, and says both.
  const both = sleep({ idle: { action: 'suspend', minutes: 30 }, lid: { ac: 'ignore', battery: 'suspend' } });
  assert.equal(both.battOnly, undefined);
  assert.match(both.detail, /After 30 minutes.*When the lid closes on battery/);
});

test('sleep row: a type with no timeout (0, never) and actions that leave the agents running are not findings', () => {
  const r = sleep({ idle: { action: 'lock', minutes: 10 }, lid: { ac: 'lock', battery: 'ignore' },
    gnome: { ac: 'suspend', acMinutes: null, battery: 'blank', batteryMinutes: 5 } });
  assert.equal(r.state, STATE.OK);
  assert.match(r.title, /not set to go to sleep on its own/);
  assert.match(r.detail, /We read logind's settings and the desktop's power settings\.$/);
});

test('sleep row: OK without a desktop reading says which settings were read, and that a desktop\'s own may still sleep', () => {
  const r = sleep({ idle: QUIET_IDLE, lid: null, gnome: null });
  assert.equal(r.state, STATE.OK);
  assert.match(r.detail, /We read logind's settings\. If this computer has a desktop, its own power settings can still put it to sleep/);
  const desk = sleep({ idle: null, lid: null, gnome: { ac: 'nothing', acMinutes: null, battery: 'nothing', batteryMinutes: null } });
  assert.match(desk.detail, /We read the desktop's power settings\.$/, 'only what was read is named');
});

/* The reader, through a fake runner and opts.hasLid. */
function sleepRunner(over) {
  const v = Object.assign({
    IdleAction: 's "suspend"', IdleActionUSec: 't 1800000000',
    HandleLidSwitch: 's "suspend"', HandleLidSwitchExternalPower: 's ""',
    gsd: 'active',
    'sleep-inactive-ac-type': "'suspend'", 'sleep-inactive-ac-timeout': 'uint32 1200',
    'sleep-inactive-battery-type': "'suspend'", 'sleep-inactive-battery-timeout': 'uint32 900',
  }, over || {});
  const asked = [];
  const runner = (cmd, args) => {
    asked.push([cmd, ...args]);
    if (cmd === 'busctl') return v[args[4]] == null ? { ok: false } : { ok: true, stdout: v[args[4]] + '\n' };
    if (cmd === 'systemctl') return v.gsd === 'active' ? { ok: true, stdout: 'active\n' } : { ok: false };
    if (cmd === 'gsettings') return v[args[2]] == null ? { ok: false } : { ok: true, stdout: v[args[2]] + '\n' };
    return { ok: false };
  };
  return { runner, asked };
}

test('sleep reader: logind, the lid and GNOME are read, and every command is a look', () => {
  const { runner, asked } = sleepRunner();
  const got = machine.readLinuxSleep({ runner, hasLid: true });
  assert.deepEqual(got, {
    idle: { action: 'suspend', minutes: 30 },
    lid: { battery: 'suspend', ac: 'suspend' },   // an empty HandleLidSwitchExternalPower means HandleLidSwitch applies
    gnome: { ac: 'suspend', acMinutes: 20, battery: 'suspend', batteryMinutes: 15 },
  });
  for (const a of asked) {
    const look = (a[0] === 'busctl' && a[1] === 'get-property')
      || (a[0] === 'systemctl' && a[1] === '--user' && a[2] === 'is-active')
      || (a[0] === 'gsettings' && a[1] === 'get');
    assert.ok(look, 'a Settings read must change nothing: ' + a.join(' '));
  }
});

test('sleep reader: GNOME\'s settings count only while its power service runs (control: same settings, service off)', () => {
  const { runner } = sleepRunner({ gsd: 'inactive', IdleAction: 's "ignore"' });
  const got = machine.readLinuxSleep({ runner, hasLid: false });
  assert.equal(got.gnome, null, 'a server with the schema but no desktop session reads no GNOME setting');
  assert.equal(got.lid, null, 'no lid and no battery: the lid switch does not count');
  assert.equal(sleep(got).state, STATE.OK);
});

test('sleep reader: logind unreadable and no desktop is no reading at all, and the row is absent', () => {
  const { runner } = sleepRunner({ IdleAction: null, IdleActionUSec: null, HandleLidSwitch: null, gsd: 'inactive' });
  const got = machine.readLinuxSleep({ runner, hasLid: true });
  assert.deepEqual(got, { idle: null, lid: null, gnome: null });
  assert.equal(sleep(got), null);
});

test('sleep reader: a set HandleLidSwitchExternalPower is the plugged-in answer', () => {
  const { runner } = sleepRunner({ HandleLidSwitchExternalPower: 's "ignore"', IdleAction: 's "ignore"', gsd: 'inactive' });
  const got = machine.readLinuxSleep({ runner, hasLid: true });
  assert.deepEqual(got.lid, { battery: 'suspend', ac: 'ignore' });
  assert.equal(sleep(got).battOnly, true);
});

/* ---------------------------------------------------------------------------
   3. The wizard's gate and Settings' check() on Linux
   --------------------------------------------------------------------------- */

test('sleepGate on linux gives the Mac\'s three answers from Linux\'s reading, with its sentence, and never asks pmset', () => {
  const asked = [];
  const gate = (reading) => machine.sleepGate({ platform: 'linux', linuxSleep: reading, runner: (c) => { asked.push(c); return { ok: false }; } });
  assert.deepEqual(gate({ idle: QUIET_IDLE, lid: null, gnome: null }), { checkable: true, prevented: true });
  const no = gate({ idle: { action: 'suspend', minutes: 30 }, lid: null, gnome: null });
  assert.equal(no.checkable, true);
  assert.equal(no.prevented, false);
  assert.match(no.because, /can go to sleep on its own/);
  assert.equal(no.battOnly, false);
  assert.equal(gate({ idle: QUIET_IDLE, lid: { ac: 'ignore', battery: 'suspend' }, gnome: null }).battOnly, true);
  assert.deepEqual(gate({ idle: null, lid: null, gnome: null }), { checkable: false, because: 'we could not read this computer\'s sleep settings' });
  assert.ok(!asked.some((c) => /pmset/.test(c)), 'no pmset on Linux');
});

test('check() on linux draws the sleep row when a setting was read, beside the restart row', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-8384-'));
  try {
    const got = machine.check({ platform: 'linux', claudeBin: process.execPath, tmuxBin: process.execPath, appDirs: [empty, empty],
      runner: () => ({ ok: false }),
      linuxSleep: { idle: { action: 'suspend', minutes: 30 }, lid: null, gnome: null },
      linuxBoard: { unitFile: true, unitState: 'enabled', linger: false, installed: BUNDLE } });
    const keys = got.checks.map((c) => c.key);
    assert.deepEqual(keys, ['installed', 'sleep', 'autostart']);
    assert.equal(got.attention, got.checks.filter((c) => c.state === STATE.ATTENTION).length);
    assert.ok(got.checks.find((c) => c.key === 'sleep').state === STATE.ATTENTION);
  } finally { fs.rmSync(empty, { recursive: true, force: true }); }
});
