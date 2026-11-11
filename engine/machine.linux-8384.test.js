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

test('restart row: no unit and no systemd on this computer says so, and never says a reinstall fixes it (review 6)', () => {
  const r = row({ unitFile: false, installed: BUNDLE, systemdRunning: false });
  assert.equal(r.state, STATE.ATTENTION);
  assert.match(r.detail, /does not run systemd.*kosmos start/);
  assert.doesNotMatch(r.detail, /Reinstalling/);
  assert.match(row({ unitFile: false, installed: BUNDLE, systemdRunning: true }).detail, /Reinstalling Kosmos puts it back/, 'control');
});

test('restart row: a unit file on a computer with no systemd still says no systemd, and asks systemctl nothing (review 8)', () => {
  assert.match(row({ unitFile: true, unitState: null, installed: BUNDLE, systemdRunning: false }).detail, /does not run systemd/);
  const asked = [];
  const got = withUnitDir(true, () => machine.readLinuxBoardAutostart((c) => { asked.push(c); return { ok: false }; }, { runner: () => ({ ok: false }), installedRoot: BUNDLE, lingerOn: true, systemdRunning: false }));
  assert.equal(got.unitState, null);
  assert.ok(!asked.includes('systemctl'), 'no systemd, no systemctl');
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

test('restart row: a unit state Kosmos never writes (static, indirect, generated) is unknown, not "switched off"', () => {
  for (const st of ['static', 'indirect', 'generated', 'transient', 'bad']) {
    const r = row({ unitFile: true, unitState: st, installed: BUNDLE });
    assert.equal(r.state, STATE.UNKNOWN, st);
    assert.match(r.detail, new RegExp('did not expect \\(' + st + '\\)'), st);
  }
  assert.match(row({ unitFile: true, unitState: 'linked', installed: BUNDLE }).detail, /switched off/, 'control: linked is off');
});

test('restart row: an enabled-runtime unit is switched on only until the next restart; masked-runtime is masked', () => {
  const rt = row({ unitFile: true, unitState: 'enabled-runtime', linger: true, installed: BUNDLE });
  assert.equal(rt.state, STATE.ATTENTION);
  assert.match(rt.title, /will not start by itself after a restart/);
  assert.match(rt.detail, /only until this computer next restarts/);
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
  const got = withUnitDir(true, () => machine.readLinuxBoardAutostart(runner, { runner, installedRoot: BUNDLE, user: 'pat' }));
  assert.deepEqual(got, { unitFile: true, unitState: 'enabled', linger: false, installed: BUNDLE, user: 'pat', systemdRunning: null, unitName: require('./linuxboard').boardUnitName() },
    'systemdRunning is null in a test with no seam: the host\'s /run/systemd is not read');
  assert.equal(row(got).admin, 'loginctl enable-linger pat', 'the command names this account, not the admin\'s own');
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
  const none = withUnitDir(false, () => machine.readLinuxBoardAutostart(runner, { runner, installedRoot: null, lingerOn: true }));
  assert.equal(none.unitFile, false);
  assert.equal(none.unitState, null);
  assert.ok(!asked.includes('systemctl'), 'no unit, no systemctl');
  const odd = withUnitDir(true, () => machine.readLinuxBoardAutostart(runner, { runner, installedRoot: BUNDLE, lingerOn: true }));
  assert.equal(odd.unitState, null, 'a reply with no UnitFileState line is no reading');
  assert.equal(row(odd).state, STATE.UNKNOWN);
});

test('restart reader: a sandboxed board asks systemd nothing, so it never reads the person\'s real unit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-8384-launch-'));
  const prevS = process.env.AGENT_WORKFORCE_SYSTEMD_DIR, prevL = process.env.AGENT_WORKFORCE_LAUNCH;
  delete process.env.AGENT_WORKFORCE_SYSTEMD_DIR; process.env.AGENT_WORKFORCE_LAUNCH = dir;
  const asked = [];
  try {
    const units = path.join(dir, 'systemd', 'user');   // linuxjob.defaultSystemdDir under a sandbox
    fs.mkdirSync(units, { recursive: true });
    fs.writeFileSync(path.join(units, require('./linuxboard').boardUnitName()), '[Unit]\n');
    const got = machine.readLinuxBoardAutostart((c) => { asked.push(c); return { ok: true, stdout: 'UnitFileState=enabled\nLinger=yes\n' }; }, { installedRoot: BUNDLE });
    assert.equal(got.sandboxed, true);
    assert.equal(got.unitState, null);
    assert.equal(got.linger, undefined);
    assert.deepEqual(asked, [], 'no systemctl and no loginctl from a sandbox');
    assert.equal(row(got).state, STATE.UNKNOWN);
    assert.match(row(got).detail, /runs apart from this computer's own services, so we did not ask/, 'it does not say systemd failed to answer');
  } finally {
    if (prevS === undefined) delete process.env.AGENT_WORKFORCE_SYSTEMD_DIR; else process.env.AGENT_WORKFORCE_SYSTEMD_DIR = prevS;
    if (prevL === undefined) delete process.env.AGENT_WORKFORCE_LAUNCH; else process.env.AGENT_WORKFORCE_LAUNCH = prevL;
    fs.rmSync(dir, { recursive: true, force: true });
  }
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

test('sleep row: a stop while plugged in, open and idle is the plain warning, in words for what it does', () => {
  const cases = [
    [{ idle: { action: 'suspend', minutes: 30 } }, /can go to sleep on its own$/, /After 30 minutes with nobody using it, this computer goes to sleep\. Your agents stop until it wakes\. An administrator can change it from a root shell, then restart the computer\.$/, true],
    [{ idle: { action: 'poweroff', minutes: 1 } }, /can turn off on its own$/, /After 1 minute .* turns off\. Your agents stop until it is started again\./, true],
    [{ idle: { action: 'reboot', minutes: 5 } }, /can restart on its own$/, /restarts\. Your agents stop while it restarts\./, true],
    [{ idle: QUIET_IDLE, gnome: { ac: 'suspend', acMinutes: 20, battery: null, batteryMinutes: null } }, /can go to sleep on its own$/, /While it is plugged in, after 20 minutes with nobody using it, the desktop puts it to sleep\..*Power settings, under Automatic Suspend\.$/, false],
    [{ idle: QUIET_IDLE, gnome: { ac: 'shutdown', acMinutes: 30, battery: null, batteryMinutes: null } }, /can turn off on its own$/, /the desktop turns it off\. Your agents stop until it is started again\./, false],
    [{ idle: { action: 'suspend', minutes: 30 }, gnome: { ac: 'shutdown', acMinutes: 30, battery: null, batteryMinutes: null } }, /can go to sleep or turn off on its own$/, /Automatic Suspend\. An administrator can change the rest from a root shell, then restart the computer\.$/, true],
  ];
  for (const [reading, title, detail, admin] of cases) {
    const r = sleep(reading);
    const label = JSON.stringify(reading);
    assert.equal(r.key, 'sleep');
    assert.equal(r.state, STATE.ATTENTION, label);
    assert.equal(r.battOnly, undefined, 'plugged-in findings are not battery-only: ' + label);
    assert.match(r.title, title, label);
    assert.match(r.detail, detail, label);
    assert.doesNotMatch(r.detail, /\/etc\//, 'a file path is for the admin field, not the sentence: ' + label);
    if (admin) { assert.match(r.admin, /' > \/etc\/systemd\/logind\.conf\.d\/zz-kosmos-idle\.conf$/, label); assert.match(r.detail, /then restart the computer\.$/, label); }
    else assert.equal(r.admin, undefined, 'no logind advice when only the desktop fired: ' + label);
    assert.equal(r.settings, undefined, 'no "Open sleep settings" button: that opens macOS\'s pane');
  }
});

test('sleep row: the lid and battery are the expected pauses, as on the Mac (battOnly), even when the lid sleeps on AC', () => {
  const cases = [
    [{ idle: QUIET_IDLE, lid: { ac: 'suspend', battery: 'suspend' } }, /can go to sleep when its lid closes$/, /When the lid closes, this computer goes to sleep\./],
    [{ idle: QUIET_IDLE, lid: { ac: 'ignore', battery: 'suspend' } }, /when its lid closes$/, /When the lid closes on battery/],
    [{ idle: QUIET_IDLE, gnome: { ac: 'nothing', acMinutes: null, battery: 'suspend', batteryMinutes: 15 } }, /can go to sleep on battery$/, /On battery, after 15 minutes with nobody using it, the desktop puts it to sleep/],
    [{ idle: QUIET_IDLE, lid: { ac: 'suspend', battery: 'suspend' }, gnome: { ac: 'nothing', acMinutes: null, battery: 'suspend', batteryMinutes: 15 } }, /on battery, or when its lid closes$/, /On battery.*When the lid closes/],
  ];
  for (const [reading, title, words] of cases) {
    const r = sleep(reading);
    const label = JSON.stringify(reading);
    assert.equal(r.state, STATE.ATTENTION, label);
    assert.equal(r.battOnly, true, label);
    assert.match(r.title, title, label);
    assert.match(r.detail, words, label);
    assert.match(r.detail, /Plugged in and open, it keeps working/, label);
  }
  // Control: one plugged-in idle finding beside a lid one makes the whole row the plain warning, and says both.
  const both = sleep({ idle: { action: 'suspend', minutes: 30 }, lid: { ac: 'ignore', battery: 'suspend' } });
  assert.equal(both.battOnly, undefined);
  assert.match(both.detail, /After 30 minutes.*When the lid closes on battery/);
});

test('sleep row: a type with no timeout (0, never) and actions that leave the agents running are not findings', () => {
  const r = sleep({ idle: { action: 'lock', minutes: 10 }, lid: { ac: 'lock', battery: 'ignore' },
    gnome: { ac: 'suspend', acMinutes: 0, battery: 'blank', batteryMinutes: 5 } });
  assert.equal(r.state, STATE.OK);
  assert.match(r.title, /^This computer is not set to go to sleep on its own$/);
  assert.match(r.detail, /We read Linux's own settings and your desktop's power settings\./);
  assert.match(r.detail, /The login screen has a sleep setting of its own, which we cannot read/, 'GDM\'s own suspend is named, not vouched for');
});

test('sleep row: a GNOME timeout that could not be read is not "never" (review 4)', () => {
  const r = sleep({ idle: QUIET_IDLE, gnome: { ac: 'suspend', acMinutes: null, battery: null, batteryMinutes: null } });
  assert.equal(r.state, STATE.ATTENTION);
  assert.match(r.detail, /While it is plugged in, after a while with nobody using it, the desktop puts it to sleep/);
});

test('sleep row: only the desktop read, the OK title says it was the desktop\'s settings', () => {
  const r = sleep({ idle: null, lid: null, gnome: { ac: 'nothing', acMinutes: 0, battery: null, batteryMinutes: null } });
  assert.equal(r.title, 'Your desktop\'s power settings do not put this computer to sleep');
});

test('sleep row: the admin field is a logind snippet for what fired, never prose', () => {
  assert.equal(sleep({ idle: { action: 'suspend', minutes: 30 } }).admin,
    "mkdir -p /etc/systemd/logind.conf.d && printf '[Login]\\nIdleAction=ignore\\n' > /etc/systemd/logind.conf.d/zz-kosmos-idle.conf");
  // The lid fix is the plugged-in key only, so closed on battery it still sleeps (review 7); battery-only offers none.
  assert.equal(sleep({ idle: QUIET_IDLE, lid: { ac: 'ignore', battery: 'suspend' } }).admin, undefined);
  // Run for real into a temp file (no sudo, the path swapped): the file it writes is what logind reads, one key a line.
  const lidCmd = sleep({ idle: QUIET_IDLE, lid: { ac: 'suspend', battery: 'suspend' } }).admin;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-8384-logind-'));
  try {
    const out = path.join(tmp, 'kosmos.conf');
    const local = lidCmd.replace(/^mkdir -p \S+ && /, '').replace('/etc/systemd/logind.conf.d/zz-kosmos-lid.conf', JSON.stringify(out));
    assert.notEqual(local, lidCmd, 'control: the path was swapped, so nothing is written under /etc');
    require('node:child_process').execFileSync('/bin/sh', ['-c', local]);
    assert.equal(fs.readFileSync(out, 'utf8'), '[Login]\nHandleLidSwitchExternalPower=ignore\n');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('sleep row: a desktop whose own settings were not read is said plainly, under a title about Linux\'s own settings', () => {
  const r = sleep({ idle: QUIET_IDLE, lid: null, gnome: null, desktop: true });
  // OK, not UNKNOWN: on KDE it could never clear (#8375's rule); decided in the plan.
  assert.equal(r.state, STATE.OK);
  assert.equal(r.title, 'Linux\'s own settings do not put this computer to sleep');
  assert.match(r.detail, /^Its desktop and its login screen have sleep settings of their own, which we could not read/);
  assert.doesNotMatch(r.detail, /on a server/, 'a desktop is not told it is a server');
  assert.match(sleep({ idle: QUIET_IDLE, lid: null, gnome: null, desktop: false }).detail, /on a server/, 'control: no display manager');
  const { runner, asked } = sleepRunner({ IdleAction: 's "ignore"', gsd: 'inactive' });
  const dmRunner = (c, a) => (c === 'systemctl' && a[0] === 'is-active' && a[1] === 'display-manager.service') ? { ok: true, stdout: 'active\n' } : runner(c, a);
  assert.equal(machine.readLinuxSleep({ runner: dmRunner, hasLid: false }).desktop, true);
  assert.equal(machine.readLinuxSleep({ runner, hasLid: false }).desktop, false, 'control: no display manager');
  assert.ok(asked.some((a) => a[0] === 'systemctl' && a[1] === 'is-active' && a[2] === 'display-manager.service'));
});

test('sleep row: OK without a desktop reading says only Linux\'s own settings were read, in the title too', () => {
  const r = sleep({ idle: QUIET_IDLE, lid: null, gnome: null });
  assert.equal(r.state, STATE.OK);
  assert.equal(r.title, 'Linux\'s own settings do not put this computer to sleep');
  assert.match(r.detail, /If this computer has a desktop, its own power settings can still put it to sleep/);
  const desk = sleep({ idle: null, lid: null, gnome: { ac: 'nothing', acMinutes: null, battery: null, batteryMinutes: null } });
  assert.match(desk.detail, /We read your desktop's power settings\./, 'only what was read is named');
});

test('linuxHasLid: an ACPI lid or the computer\'s own battery counts; a wireless mouse\'s battery does not', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-8384-sys-'));
  const lid = path.join(root, 'lid'), sup = path.join(root, 'power_supply');
  const supply = (name, files) => { fs.mkdirSync(path.join(sup, name), { recursive: true }); for (const [f, v] of Object.entries(files)) fs.writeFileSync(path.join(sup, name, f), v + '\n'); };
  try {
    fs.mkdirSync(sup, { recursive: true });
    assert.equal(machine.linuxHasLid(lid, sup), false, 'no lid folder, no supplies');
    supply('hid-00:1f:20:aa:bb:cc-battery', { type: 'Battery', scope: 'Device' });
    supply('AC', { type: 'Mains' });
    assert.equal(machine.linuxHasLid(lid, sup), false, 'a desktop with a Bluetooth mouse is not a laptop');
    supply('BAT0', { type: 'Battery' });
    assert.equal(machine.linuxHasLid(lid, sup), true, 'a laptop battery (no scope file) counts');
    fs.rmSync(path.join(sup, 'BAT0'), { recursive: true });
    supply('BAT1', { type: 'Battery', scope: 'System' });
    assert.equal(machine.linuxHasLid(lid, sup), true, 'scope System counts');
    fs.rmSync(path.join(sup, 'BAT1'), { recursive: true });
    fs.mkdirSync(path.join(lid, 'LID0'), { recursive: true });
    assert.equal(machine.linuxHasLid(lid, sup), true, 'an ACPI lid button counts on its own');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

/* The reader, through a fake runner and opts.hasLid. */
function sleepRunner(over) {
  const v = Object.assign({
    IdleAction: 's "suspend"', IdleActionUSec: 't 1800000000',
    HandleLidSwitch: 's "suspend"', HandleLidSwitchExternalPower: 's ""',
    gsd: 'active',
    // gsettings prints the timeouts as plain numbers (type i in the schema).
    'sleep-inactive-ac-type': "'suspend'", 'sleep-inactive-ac-timeout': '1200',
    'sleep-inactive-battery-type': "'suspend'", 'sleep-inactive-battery-timeout': '900',
  }, over || {});
  const asked = [];
  const runner = (cmd, args) => {
    asked.push([cmd, ...args]);
    if (cmd === 'busctl') return v[args[5]] == null ? { ok: false } : { ok: true, stdout: v[args[5]] + '\n' };
    if (cmd === 'systemctl') return v.gsd === 'active' ? { ok: true, stdout: 'active\n' } : { ok: false };
    if (cmd === 'gsettings') return v[args[2]] == null ? { ok: false } : { ok: true, stdout: v[args[2]] + '\n' };
    return { ok: false };
  };
  return { runner, asked };
}

test('sleep reader: logind, the lid and GNOME are read, and every command is a look', () => {
  const { runner, asked } = sleepRunner();
  const got = machine.readLinuxSleep({ runner, hasLid: true, hasBattery: true });
  assert.deepEqual(got, {
    idle: { action: 'suspend', minutes: 30 },
    lid: { battery: 'suspend', ac: 'suspend', docked: null },   // an empty HandleLidSwitchExternalPower means HandleLidSwitch applies
    gnome: { ac: 'suspend', acMinutes: 20, battery: 'suspend', batteryMinutes: 15 },
    desktop: null,   // GNOME was read, so the display manager is not asked
  });
  for (const a of asked) {
    const look = (a[0] === 'busctl' && a[1] === '--system' && a[2] === 'get-property')
      || (a[0] === 'systemctl' && ((a[1] === '--user' && a[2] === 'is-active') || a[1] === 'is-active'))
      || (a[0] === 'gsettings' && a[1] === 'get')
      || (a[0] === 'systemd-detect-virt' && a[1] === '--vm');
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
  const { runner, asked } = sleepRunner({ IdleAction: null, gsd: 'inactive' });
  const got = machine.readLinuxSleep({ runner, hasLid: true });
  assert.deepEqual(got, { idle: null, lid: null, gnome: null, desktop: false });
  assert.equal(asked.filter((a) => a[0] === 'busctl').length, 1, 'a logind that does not answer is asked once, not five times');
  assert.equal(sleep(got), null);
});

test('sleep reader: GNOME\'s battery setting counts only on a machine with a battery (a desktop keeps the stock suspend)', () => {
  const { runner, asked } = sleepRunner({ IdleAction: 's "ignore"', 'sleep-inactive-ac-type': "'nothing'" });
  const desk = machine.readLinuxSleep({ runner, hasLid: false, hasBattery: false });
  assert.equal(desk.gnome.battery, null);
  assert.equal(sleep(desk).state, STATE.OK, 'a desktop PC with GNOME\'s defaults is not told it sleeps on battery');
  assert.ok(!asked.some((a) => a[0] === 'gsettings' && /battery/.test(a[2])), 'the battery keys are not asked');
  const laptop = machine.readLinuxSleep({ runner: sleepRunner({ IdleAction: 's "ignore"', 'sleep-inactive-ac-type': "'nothing'" }).runner, hasLid: false, hasBattery: true });
  assert.equal(sleep(laptop).battOnly, true, 'control: the same settings on a laptop are the battery note');
});

test('sleep reader: IdleActionSec=infinity is no idle action, not 307 trillion minutes (review 4)', () => {
  const { runner } = sleepRunner({ IdleActionUSec: 't 18446744073709551615', gsd: 'inactive' });
  const got = machine.readLinuxSleep({ runner, hasLid: false });
  assert.deepEqual(got.idle, { action: 'ignore', minutes: null });
  assert.equal(sleep(got).state, STATE.OK);
});

test('sleep reader: a gsettings that fails is not asked again, and its timeout reads as unknown, not never', () => {
  const { runner, asked } = sleepRunner({ IdleAction: 's "ignore"', 'sleep-inactive-ac-timeout': null });
  const got = machine.readLinuxSleep({ runner, hasLid: false, hasBattery: true });
  assert.equal(got.gnome.ac, 'suspend');
  assert.equal(got.gnome.acMinutes, null);
  assert.equal(asked.filter((a) => a[0] === 'gsettings').length, 2, 'type, then the failed timeout, then nothing more');
  assert.equal(sleep(got).state, STATE.ATTENTION);
});

test('sleep row: a lid that does different things on AC and on battery says both (review 6)', () => {
  const r = sleep({ idle: QUIET_IDLE, lid: { ac: 'poweroff', battery: 'suspend' } });
  assert.match(r.detail, /When the lid closes while it is plugged in, this computer turns off\. When the lid closes on battery, it goes to sleep\./);
  assert.match(r.title, /can go to sleep or turn off when its lid closes$/);
});

test('sleep row: the external-screen exception is said only when logind\'s docked setting was read as leaving it awake', () => {
  assert.match(sleep({ idle: QUIET_IDLE, lid: { ac: 'suspend', battery: 'suspend', docked: 'ignore' } }).detail, /goes to sleep, unless another screen is connected\./);
  assert.doesNotMatch(sleep({ idle: QUIET_IDLE, lid: { ac: 'suspend', battery: 'suspend', docked: 'suspend' } }).detail, /another screen/);
  assert.doesNotMatch(sleep({ idle: QUIET_IDLE, lid: { ac: 'suspend', battery: 'suspend' } }).detail, /another screen/, 'not read, not said');
});

test('restart row: masked offers the unmask and enable commands for this board\'s unit', () => {
  assert.equal(row({ unitFile: true, unitState: 'masked', installed: BUNDLE, unitName: 'kosmos-board.service' }).admin,
    'systemctl --user unmask kosmos-board.service && systemctl --user enable kosmos-board.service');
});

test('restart reader: a test with a unit folder but no runner runs no host command (review 9)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-8384-bin-'));
  const marker = path.join(dir, 'ran');
  for (const t of ['systemctl', 'loginctl']) fs.writeFileSync(path.join(dir, t), '#!/bin/sh\necho "$0" >> ' + JSON.stringify(marker) + '\necho UnitFileState=enabled\necho Linger=yes\n', { mode: 0o755 });
  const prevPath = process.env.PATH;
  process.env.PATH = dir + path.delimiter + prevPath;
  try {
    // As check() calls it with no runner of the caller's: a real runner positionally, none in opts.
    const got = withUnitDir(true, () => machine.readLinuxBoardAutostart((c, a) => { try { return { ok: true, stdout: require('node:child_process').execFileSync(c, a, { encoding: 'utf8' }) }; } catch { return { ok: false }; } }, { installedRoot: BUNDLE }));
    assert.equal(got.unitState, null);
    assert.equal(got.linger, undefined);
    assert.equal(fs.existsSync(marker), false, 'neither fake was run');
    // Control: given that runner explicitly as opts.runner, the fakes do run (so the absence above is the guard).
    const real = (c, a) => { try { return { ok: true, stdout: require('node:child_process').execFileSync(c, a, { encoding: 'utf8' }) }; } catch { return { ok: false }; } };
    const ctl = withUnitDir(true, () => machine.readLinuxBoardAutostart(real, { installedRoot: BUNDLE, runner: real }));
    assert.equal(ctl.unitState, 'enabled');
    assert.equal(fs.existsSync(marker), true);
  } finally { process.env.PATH = prevPath; fs.rmSync(dir, { recursive: true, force: true }); }
});

test('sleep row: a lid that sleeps only while plugged in says so', () => {
  assert.match(sleep({ idle: QUIET_IDLE, lid: { ac: 'suspend', battery: 'ignore' } }).detail, /When the lid closes while it is plugged in, this computer goes to sleep\./);
});

test('sleep reader: a set HandleLidSwitchExternalPower is the plugged-in answer', () => {
  const { runner } = sleepRunner({ HandleLidSwitchExternalPower: 's "ignore"', IdleAction: 's "ignore"', gsd: 'inactive' });
  const got = machine.readLinuxSleep({ runner, hasLid: true });
  assert.deepEqual(got.lid, { battery: 'suspend', ac: 'ignore', docked: null });
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
  assert.deepEqual(gate({ idle: QUIET_IDLE, lid: null, gnome: null, desktop: true }), { checkable: false, because: 'we could not read this computer\'s desktop sleep settings' },
    'a desktop not read is neither a failed gate nor a passed one (review 8)');
  assert.ok(!asked.some((c) => /pmset/.test(c)), 'no pmset on Linux');
});

test('check() on linux reads sleep through the caller\'s runner, and with no runner and no reading in a test reads nothing', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-8384-'));
  try {
    const { runner, asked } = sleepRunner({ gsd: 'inactive' });
    const got = machine.check({ platform: 'linux', claudeBin: process.execPath, tmuxBin: process.execPath, appDirs: [empty, empty],
      runner, linuxBoard: { unitFile: false, installed: null } });
    assert.ok(asked.some((a) => a[0] === 'busctl'), 'logind was asked through the runner check() was given');
    assert.equal(got.checks.find((c) => c.key === 'sleep').state, STATE.ATTENTION, 'IdleAction=suspend from the fake runner');
    /* A busctl on PATH that says "suspend after 30 minutes", so a host read would show a sleep row on any machine
       (on a Mac with no busctl a host read fails quietly and looks the same as no read). */
    const bin = path.join(empty, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'busctl'), '#!/bin/sh\ncase "$*" in *USec*) echo "t 1800000000";; *) echo \'s "suspend"\';; esac\n', { mode: 0o755 });
    const prevPath = process.env.PATH;
    process.env.PATH = bin + path.delimiter + prevPath;
    let bare, gate, direct;
    try {
      bare = machine.check({ platform: 'linux', claudeBin: process.execPath, tmuxBin: process.execPath, appDirs: [empty, empty],
        linuxBoard: { unitFile: false, installed: null } });
      gate = machine.sleepGate({ platform: 'linux' });
      direct = machine.readLinuxSleep({});
      // Control: the fake answers when it IS asked, so the absences above are the guard, not a broken fake.
      // Only busctl is run for real (it is the fake on PATH); every other command answers no, so nothing of the host runs.
      var control = machine.readLinuxSleep({ runner: (c, a) => { if (c !== 'busctl') return { ok: false }; try { return { ok: true, stdout: require('node:child_process').execFileSync(c, a, { encoding: 'utf8' }) }; } catch { return { ok: false }; } } });
    } finally { process.env.PATH = prevPath; }
    assert.equal(bare.checks.find((c) => c.key === 'sleep'), undefined, 'no seam in a test: no host read, so no sleep row');
    assert.equal(gate.checkable, false);
    assert.deepEqual(direct, { idle: null, lid: null, gnome: null, desktop: null });
    assert.deepEqual(control.idle, { action: 'suspend', minutes: 30 }, 'control: the fake busctl does answer');
  } finally { fs.rmSync(empty, { recursive: true, force: true }); }
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
