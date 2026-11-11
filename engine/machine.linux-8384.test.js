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

test('restart row: each fixable arm carries its one command; the OK and the missing arms carry none', () => {
  assert.match(row({ unitFile: true, unitState: 'enabled', linger: false, installed: BUNDLE }).admin, /^loginctl enable-linger$/);
  assert.match(row({ unitFile: true, unitState: 'enabled', linger: false, installed: BUNDLE }).detail, /if it asks for a password you do not have, an administrator runs it\./);
  assert.equal(row({ unitFile: true, unitState: 'disabled', installed: BUNDLE, unitName: 'kosmos-board.service' }).admin, 'systemctl --user enable kosmos-board.service');
  assert.equal(row({ unitFile: true, unitState: 'enabled-runtime', installed: BUNDLE, unitName: 'kosmos-board.service' }).admin, 'systemctl --user enable kosmos-board.service');
  for (const r of [
    { unitFile: true, unitState: 'enabled', linger: true, installed: BUNDLE },
    { unitFile: false, installed: BUNDLE },
  ]) assert.equal(row(r).admin, undefined, JSON.stringify(r));
});

test('restart row: a unit state Kosmos never writes (static, indirect, generated) is unknown, not "switched off"', () => {
  for (const st of ['static', 'indirect', 'generated', 'transient', 'bad']) {
    const r = row({ unitFile: true, unitState: st, installed: BUNDLE });
    assert.equal(r.state, STATE.UNKNOWN, st);
    assert.match(r.detail, /set up in a way Kosmos did not expect, so we cannot tell/, st);
    assert.ok(!r.detail.includes('(' + st + ')'), 'no raw systemd word in the sentence: ' + st);
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
  assert.deepEqual(got, { unitFile: true, unitState: 'enabled', linger: false, installed: BUNDLE, user: 'pat', systemdRunning: null, unitName: require('./linuxboard').boardUnitName(), maskedFile: false },
    'systemdRunning is null in a test with no seam: the host\'s /run/systemd is not read');
  assert.equal(row(got).admin, "loginctl enable-linger 'pat'", 'the command names this account, not the admin\'s own');
  assert.equal(row(got).state, STATE.ATTENTION, 'enabled with linger off is the log-out warning');
  for (const a of asked) {
    assert.ok((a[0] === 'systemctl' && a[2] === 'show') || (a[0] === 'loginctl' && a[1] === 'show-user'),
      'a Settings read must change nothing: ' + a.join(' '));
  }
  assert.ok(asked.some((a) => a[0] === 'loginctl'), 'control: linger was asked of loginctl (logind\'s file is not read in a test)');
});

test('restart reader: linger is asked only when the unit is switched on, the one arm that uses it', () => {
  const asked = [];
  const runner = (c) => { asked.push(c); return c === 'systemctl' ? { ok: true, stdout: 'UnitFileState=disabled\n' } : { ok: true, stdout: 'Linger=yes\n' }; };
  const got = withUnitDir(true, () => machine.readLinuxBoardAutostart(runner, { runner, installedRoot: BUNDLE }));
  assert.equal(got.unitState, 'disabled');
  assert.equal(got.linger, undefined);
  assert.deepEqual(asked, ['systemctl'], 'no loginctl for a switched-off unit');
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
    assert.equal(row(got), null, 'a sandbox has no row, not a standing could-not-check');
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
    [{ idle: { action: 'suspend', minutes: 30 } }, /can go to sleep on its own$/, /After 30 minutes with nobody using it, this computer goes to sleep\. Your agents stop until it wakes\. An administrator can change it from a root shell \(the command under For IT admins\), then restart the computer\. Your agents stop while it restarts, and come back by themselves only if Kosmos starts by itself \(the row about that says\)\.$/, true],
    [{ idle: { action: 'poweroff', minutes: 1 } }, /can turn off on its own$/, /After 1 minute .* turns off\. Your agents stop until it is started again\./, true],
    [{ idle: { action: 'reboot', minutes: 5 } }, /can restart on its own$/, /restarts\. Your agents stop while it restarts\./, true],
    [{ idle: QUIET_IDLE, gnome: { ac: 'suspend', acMinutes: 20, battery: null, batteryMinutes: null } }, /can go to sleep on its own$/, /While it is plugged in, after 20 minutes with nobody using it, the desktop puts it to sleep\..*Power settings, under Automatic Suspend\.$/, false],
    [{ idle: QUIET_IDLE, gnome: { ac: 'shutdown', acMinutes: 30, battery: null, batteryMinutes: null } }, /can turn off on its own$/, /the desktop turns it off\. Your agents stop until it is started again\./, false],
    [{ idle: { action: 'suspend', minutes: 30 }, gnome: { ac: 'shutdown', acMinutes: 30, battery: null, batteryMinutes: null } }, /can go to sleep or turn off on its own$/, /Automatic Suspend\. An administrator can change the rest from a root shell \(the command under For IT admins\), then restart the computer\. Your agents stop while it restarts, and come back by themselves only if Kosmos starts by itself \(the row about that says\)\.$/, true],
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
    if (admin) { assert.match(r.admin, /' > \/etc\/systemd\/logind\.conf\.d\/zz-kosmos-idle\.conf$/, label); assert.match(r.detail, /then restart the computer\. Your agents stop while it restarts, and come back by themselves only if Kosmos starts by itself \(the row about that says\)\.$/, label); }
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
  assert.equal(r.title, 'Nothing we could read puts this computer to sleep');
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
  /* Run for real with /etc/systemd/logind.conf.d swapped for a temp folder (no root): every file it writes is what logind
     reads, one [Login] section and one key a line. Idle, lid and docked all fire here, so all three files are made. */
  const cmd = sleep({ idle: { action: 'suspend', minutes: 30 }, lid: { ac: 'suspend', battery: 'suspend', docked: 'suspend' } }).admin;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-8384-logind-'));
  try {
    const local = cmd.split('/etc/systemd/logind.conf.d').join(tmp);
    assert.ok(!local.includes('/etc/'), 'control: every path was swapped, so nothing is written under /etc');
    require('node:child_process').execFileSync('/bin/sh', ['-c', local]);
    assert.deepEqual(fs.readdirSync(tmp).sort(), ['zz-kosmos-idle.conf', 'zz-kosmos-lid-docked.conf', 'zz-kosmos-lid.conf']);
    assert.equal(fs.readFileSync(path.join(tmp, 'zz-kosmos-idle.conf'), 'utf8'), '[Login]\nIdleAction=ignore\n');
    assert.equal(fs.readFileSync(path.join(tmp, 'zz-kosmos-lid.conf'), 'utf8'), '[Login]\nHandleLidSwitchExternalPower=ignore\n');
    assert.equal(fs.readFileSync(path.join(tmp, 'zz-kosmos-lid-docked.conf'), 'utf8'), '[Login]\nHandleLidSwitchDocked=ignore\n');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('sleep row: a desktop whose own settings were not read is said plainly, under a title about Linux\'s own settings', () => {
  const r = sleep({ idle: QUIET_IDLE, lid: null, gnome: null, desktop: true });
  // OK, not UNKNOWN: on KDE it could never clear (#8375's rule); decided in the plan.
  assert.equal(r.state, STATE.OK);
  assert.equal(r.title, 'Linux\'s own settings do not put this computer to sleep');
  assert.match(r.detail, /^Its desktop and its login screen have sleep settings of their own, which we could not read/);
  assert.doesNotMatch(r.detail, /virtual machine/, 'a desktop gets the desktop words');
  assert.match(sleep({ idle: QUIET_IDLE, lid: null, gnome: null, desktop: false }).detail, /unless something else puts it to sleep/, 'control: no display manager');
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
  assert.match(r.detail, /a desktop's own power settings, if it has one, or the computer it runs inside, if it is a virtual machine\.$/);
  const desk = sleep({ idle: null, lid: null, gnome: { ac: 'nothing', acMinutes: null, battery: null, batteryMinutes: null } });
  assert.match(desk.detail, /We read your desktop's power settings\./, 'only what was read is named');
});

test('linuxLid: an ACPI lid or the computer\'s own battery counts; a wireless mouse\'s battery does not', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-8384-sys-'));
  const lid = path.join(root, 'lid'), sup = path.join(root, 'power_supply');
  const supply = (name, files) => { fs.mkdirSync(path.join(sup, name), { recursive: true }); for (const [f, v] of Object.entries(files)) fs.writeFileSync(path.join(sup, name, f), v + '\n'); };
  try {
    fs.mkdirSync(sup, { recursive: true });
    assert.equal(machine.linuxLid(lid, sup).has, false, 'no lid folder, no supplies');
    supply('hid-00:1f:20:aa:bb:cc-battery', { type: 'Battery', scope: 'Device' });
    supply('AC', { type: 'Mains' });
    assert.equal(machine.linuxLid(lid, sup).has, false, 'a desktop with a Bluetooth mouse is not a laptop');
    supply('BAT0', { type: 'Battery' });
    assert.equal(machine.linuxLid(lid, sup).has, true, 'a laptop battery (no scope file) counts');
    fs.rmSync(path.join(sup, 'BAT0'), { recursive: true });
    supply('BAT1', { type: 'Battery', scope: 'System' });
    assert.equal(machine.linuxLid(lid, sup).has, true, 'scope System counts');
    fs.rmSync(path.join(sup, 'BAT1'), { recursive: true });
    fs.mkdirSync(path.join(lid, 'LID0'), { recursive: true });
    assert.equal(machine.linuxLid(lid, sup).has, true, 'an ACPI lid button counts on its own');
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
    // A key set to null is one this logind does not have: busctl answers that with an unknown-property error.
    if (cmd === 'busctl') return v[args[5]] == null ? { ok: false, because: 'Failed to get property: Unknown property or interface.' } : { ok: true, stdout: v[args[5]] + '\n' };
    // As systemctl is-active does: exit 0 with "active", or non-zero printing "inactive".
    if (cmd === 'systemctl') return v.gsd === 'active' ? { ok: true, stdout: 'active\n' } : { ok: false, stdout: 'inactive\n' };
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
    lid: { battery: 'suspend', ac: 'suspend', docked: null, sure: true, noExt: false, extUnread: false, desktopHandles: false },   // an empty HandleLidSwitchExternalPower means HandleLidSwitch applies
    gnome: { ac: 'suspend', acMinutes: 20, battery: 'suspend', batteryMinutes: 15 },
    desktop: null,   // GNOME was read, so the display manager is not asked
  });
  for (const a of asked) {
    const look = (a[0] === 'busctl' && a[1] === '--system' && a[2] === 'get-property')
      || (a[0] === 'systemctl' && ((a[1] === '--user' && a[2] === 'is-active') || a[1] === 'is-active'))
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
  const { runner, asked } = sleepRunner({ IdleAction: null, gsd: 'inactive' });
  const got = machine.readLinuxSleep({ runner, hasLid: true });
  assert.deepEqual(got, { idle: null, lid: null, gnome: null, desktop: null }, 'no display-manager ask when it cannot change the row');
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
  const dockedToo = sleep({ idle: QUIET_IDLE, lid: { ac: 'suspend', battery: 'suspend', docked: 'suspend' } });
  assert.doesNotMatch(dockedToo.detail, /unless another screen/);
  assert.match(dockedToo.detail, /With another screen connected, closing the lid puts it to sleep too\./, 'logind asks the docked setting first (review 11)');
  assert.match(dockedToo.admin, /zz-kosmos-lid\.conf && printf '\[Login\]\\nHandleLidSwitchDocked=ignore\\n' > \/etc\/systemd\/logind\.conf\.d\/zz-kosmos-lid-docked\.conf$/);
  assert.match(sleep({ idle: { action: 'soft-reboot', minutes: 5 } }).title, /can restart on its own/);
  assert.doesNotMatch(sleep({ idle: QUIET_IDLE, lid: { ac: 'suspend', battery: 'suspend' } }).detail, /another screen/, 'not read, not said');
});

test('restart row: masked offers unmask for this board\'s unit, then a reinstall (as the masked file does)', () => {
  const r = row({ unitFile: true, unitState: 'masked', installed: BUNDLE, unitName: 'kosmos-board.service' });
  assert.equal(r.admin, 'systemctl --user unmask kosmos-board.service');
  assert.match(r.detail, /Run the command under For IT admins from this account, then reinstall Kosmos \(Kosmos restarts for a moment\)\.$/);
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

test('sleep row: a lid that sleeps only when docked (HandleLidSwitchDocked) is a finding, not a false OK (review 10)', () => {
  const r = sleep({ idle: QUIET_IDLE, lid: { ac: 'ignore', battery: 'ignore', docked: 'suspend' } });
  assert.equal(r.state, STATE.ATTENTION);
  assert.match(r.detail, /When the lid closes with another screen connected, this computer goes to sleep\./);
});

test('restart reader: a unit file replaced by a link to /dev/null (mask --force) reads as gone, and the row says reinstall', () => {
  const got = withUnitDir(false, (dir) => {
    fs.symlinkSync('/dev/null', path.join(dir, require('./linuxboard').boardUnitName()));
    return machine.readLinuxBoardAutostart(() => ({ ok: true, stdout: 'UnitFileState=masked\n' }), { runner: () => ({ ok: true, stdout: 'UnitFileState=masked\n' }), installedRoot: BUNDLE });
  });
  assert.equal(got.maskedFile, true);
  const r = row(got);
  assert.equal(r.state, STATE.ATTENTION);
  assert.match(r.detail, /replaced by an empty one.*Run the command under For IT admins from this account, then reinstall Kosmos \(Kosmos restarts for a moment\)\./);
  assert.equal(r.admin, 'systemctl --user unmask ' + require('./linuxboard').boardUnitName(), 'unmask removes only the link, then the reinstall writes the file');
});

test('restart row: a /dev/null mask is said even when systemd did not answer (review 12)', () => {
  const r = row({ unitFile: true, unitState: null, installed: BUNDLE, maskedFile: true });
  assert.equal(r.state, STATE.ATTENTION);
  assert.match(r.detail, /replaced by an empty one/);
});

test('restart row: no systemd allows for something else starting it, such as a container\'s own rule', () => {
  assert.match(row({ unitFile: false, installed: BUNDLE, systemdRunning: false }).detail, /unless something else starts them \(a container's own restart rule, say\) or someone runs kosmos start\./);
});

test('sleep row: the lid fix says it is the plugged-in case only', () => {
  assert.match(sleep({ idle: { action: 'suspend', minutes: 30 }, lid: { ac: 'suspend', battery: 'suspend' } }).detail,
    /the row about that says\)\. After that, closing the lid on battery still puts it to sleep, as it should\.$/);
  assert.doesNotMatch(sleep({ idle: { action: 'suspend', minutes: 30 } }).detail, /closing the lid/, 'control: no lid, no lid sentence');
});

test('restart row: a runtime mask is lifted with --runtime', () => {
  assert.match(row({ unitFile: true, unitState: 'masked-runtime', installed: BUNDLE, unitName: 'kosmos-board.service' }).admin,
    /^systemctl --user unmask --runtime kosmos-board\.service$/);
});

test('sleep reader: an idle time of a year or more is no idle action', () => {
  const { runner } = sleepRunner({ IdleActionUSec: 't ' + String(366 * 24 * 3600e6), gsd: 'inactive' });
  assert.deepEqual(machine.readLinuxSleep({ runner, hasLid: false }).idle, { action: 'ignore', minutes: null });
});

test('sleep row: a lid known only from a battery is said as "if it has a lid" (a tablet has none)', () => {
  const r = sleep({ idle: QUIET_IDLE, lid: { ac: 'suspend', battery: 'suspend', sure: false } });
  assert.match(r.detail, /^If it has a lid: when the lid closes, this computer goes to sleep\./);
  assert.match(sleep({ idle: QUIET_IDLE, lid: { ac: 'suspend', battery: 'suspend', sure: true } }).detail, /^When the lid closes/, 'control');
  const { runner } = sleepRunner({ IdleAction: 's "ignore"', gsd: 'inactive' });
  assert.equal(machine.readLinuxSleep({ runner, hasLid: true, lidSure: false }).lid.sure, false);
});

test('restart row: from source with no systemd is the from-source answer, not a vague could-not-check', () => {
  assert.match(row({ unitFile: true, unitState: null, installed: null, systemdRunning: false }).title, /running from source/);
});

test('restart row: masked tells who runs the command, and the logind table knows factory-reset', () => {
  const masked = row({ unitFile: true, unitState: 'masked', installed: BUNDLE }).detail;
  assert.match(masked, /Run the command under For IT admins from this account/);
  assert.doesNotMatch(masked, /every account/);
  assert.match(sleep({ idle: { action: 'factory-reset', minutes: 5 } }).title, /can restart on its own/);
});

test('sleep row: GNOME running with its settings unreadable is could-not-check, not a tick', () => {
  const { runner } = sleepRunner({ IdleAction: 's "ignore"', 'sleep-inactive-ac-type': null });
  const got = machine.readLinuxSleep({ runner, hasLid: false });
  assert.equal(got.gnomeUnread, 'ac');
  const r = sleep(got);
  assert.equal(r.state, STATE.UNKNOWN);
  assert.match(r.title, /could not read your desktop's power settings/);
});

test('sleep row: mixed sleep and power-off say both, and "as it should" only for sleep', () => {
  const r = sleep({ idle: { action: 'suspend', minutes: 30 }, lid: { ac: 'poweroff', battery: 'poweroff' } });
  assert.match(r.detail, /Your agents stop until it wakes or it is started again\./);
  assert.match(r.detail, /closing the lid on battery still turns it off\.$/);
  assert.doesNotMatch(r.detail, /turns it off, as it should/);
});

test('sleep row: with an uncertain lid every lid sentence is hedged, the docked one too', () => {
  const r = sleep({ idle: QUIET_IDLE, lid: { ac: 'suspend', battery: 'suspend', docked: 'suspend', sure: false } });
  assert.match(r.detail, /^If it has a lid: when the lid closes, this computer goes to sleep\. With another screen connected, closing the lid puts it to sleep too\./);
});

test('sleep row: the restart case is named on an unread desktop', () => {
  assert.match(sleep({ idle: QUIET_IDLE, lid: null, gnome: null, desktop: true }).detail, /After a restart, before anyone logs in, the login screen may put it to sleep/);
});

test('sleep row: a lid that sleeps only while plugged in says so', () => {
  assert.match(sleep({ idle: QUIET_IDLE, lid: { ac: 'suspend', battery: 'ignore' } }).detail, /When the lid closes while it is plugged in, this computer goes to sleep\./);
});

test('sleep reader: a set HandleLidSwitchExternalPower is the plugged-in answer', () => {
  const { runner } = sleepRunner({ HandleLidSwitchExternalPower: 's "ignore"', IdleAction: 's "ignore"', gsd: 'inactive' });
  const got = machine.readLinuxSleep({ runner, hasLid: true });
  assert.deepEqual(got.lid, { battery: 'suspend', ac: 'ignore', docked: null, sure: true, noExt: false, extUnread: false, desktopHandles: false });
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

test('the test-process guard these readers lean on is true under the repo\'s own runner', () => {
  // Every no-host-read guard above asks live-execution.inTestRun(); if it ever read false under node --test, they
  // would all read the host. This pins it (bulletin runtime-self-detection-is-version-dependent).
  assert.equal(require('./live-execution').inTestRun(), true);
});

test('a Linux reading is kept for ten seconds, then read again', () => {
  let reads = 0, t = 1e6;
  const read = () => { reads += 1; return { n: reads }; };
  const key = 'ttl-' + Math.random();
  const o = { cacheInTest: true, now: () => t };
  assert.deepEqual(machine.linuxCached(key, o, read), { n: 1 });
  t += 9999;
  assert.deepEqual(machine.linuxCached(key, o, read), { n: 1 }, 'kept at 9.999 s');
  t += 1;
  assert.deepEqual(machine.linuxCached(key, o, read), { n: 2 }, 'read again at 10 s');
  t -= 60000;
  assert.deepEqual(machine.linuxCached(key, o, read), { n: 3 }, 'a clock set back reads again');
});

test('a Linux reading is kept for ten seconds, and a caller with a runner or a seam always reads fresh', () => {
  let reads = 0;
  const read = () => { reads += 1; return { n: reads }; };
  const key = 'test-' + Math.random();
  assert.deepEqual(machine.linuxCached(key, { cacheInTest: true }, read), { n: 1 });
  assert.deepEqual(machine.linuxCached(key, { cacheInTest: true }, read), { n: 1 }, 'the second ask within ten seconds is the kept one');
  assert.deepEqual(machine.linuxCached(key, { cacheInTest: true, runner: () => ({}) }, read), { n: 2 }, 'a runner reads fresh');
  assert.deepEqual(machine.linuxCached(key, {}, read), { n: 3 }, 'and so does any test that did not ask for the cache');
});

test('linuxLid: sure only when ACPI lists the lid, not when it is inferred from a battery', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-8384-lid-'));
  try {
    const sup = path.join(root, 'ps'); fs.mkdirSync(path.join(sup, 'BAT0'), { recursive: true });
    fs.writeFileSync(path.join(sup, 'BAT0', 'type'), 'Battery\n');
    assert.deepEqual(machine.linuxLid(path.join(root, 'nolid'), sup), { has: true, sure: false });
    fs.mkdirSync(path.join(root, 'lid', 'LID0'), { recursive: true });
    assert.deepEqual(machine.linuxLid(path.join(root, 'lid'), sup), { has: true, sure: true }, 'a listed lid plus a battery is a laptop');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('restart row: systemd answering with an empty state is "does not know", not "did not answer"', () => {
  assert.match(row({ unitFile: true, unitState: '', installed: BUNDLE }).detail, /does not know Kosmos's startup service/);
  assert.match(row({ unitFile: true, unitState: null, installed: BUNDLE }).detail, /did not answer/, 'control');
  const got = withUnitDir(true, () => machine.readLinuxBoardAutostart(() => ({ ok: true, stdout: 'UnitFileState=\n' }), { runner: () => ({ ok: true, stdout: 'UnitFileState=\n' }), installedRoot: BUNDLE, lingerOn: true }));
  assert.equal(got.unitState, '');
});

test('sleep row: GNOME unreadable with logind unreadable too is still could-not-check, and a half-read GNOME says so', () => {
  const none = sleep({ idle: null, lid: null, gnome: null, gnomeUnread: 'ac' });
  assert.equal(none.state, STATE.UNKNOWN);
  assert.match(none.detail, /Linux's own settings could not be read either\.$/, 'never claims logind was read');
  assert.match(sleep({ idle: QUIET_IDLE, lid: null, gnome: null, gnomeUnread: 'ac' }).detail, /Linux's own settings do not\.$/, 'control');
  const { runner } = sleepRunner({ IdleAction: 's "ignore"', 'sleep-inactive-battery-type': null });
  const half = machine.readLinuxSleep({ runner, hasLid: false, hasBattery: true });
  assert.equal(half.gnomeUnread, 'battery');
  assert.equal(half.gnome.ac, 'suspend', 'control: the AC half was read');
  // AC quiet, battery unread: the row is could-not-check, never the all-clear.
  const quietAc = machine.readLinuxSleep({ runner: sleepRunner({ IdleAction: 's "ignore"', 'sleep-inactive-ac-type': "'nothing'", 'sleep-inactive-battery-type': null }).runner, hasLid: false, hasBattery: true });
  assert.equal(sleep(quietAc).state, STATE.UNKNOWN);
  assert.match(sleep(quietAc).detail, /^Your desktop's plugged-in setting does not put this computer to sleep, but its battery setting did not answer/);
  // AC suspends, battery unread: the finding still shows.
  assert.equal(sleep(half).state, STATE.ATTENTION);
});

test('sleep row: the title\'s "on its own" names only what happens plugged in and idle, not the lid', () => {
  const r = sleep({ idle: { action: 'suspend', minutes: 30 }, lid: { ac: 'poweroff', battery: 'poweroff' } });
  assert.equal(r.title, 'This computer can go to sleep on its own');
  assert.match(r.detail, /When the lid closes, this computer turns off/);
});

test('restart row: the masked fix is unmask first, then the reinstall (a reinstall alone cannot lift a mask)', () => {
  const d = row({ unitFile: true, unitState: 'masked', installed: BUNDLE }).detail;
  assert.ok(d.indexOf('Run the command') < d.indexOf('reinstall Kosmos'), 'unmask comes first');
});

test('check() and the gate share the ten-second reading, so a Settings visit asks once', () => {
  let reads = 0, t = 5e6;
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-8384-'));
  // A unique key per run: the cache is the module's, so this reads through the real 'sleep' key once and clears it.
  try {
    const counting = (c) => { if (c === 'busctl') reads += 1; return c === 'busctl' ? { ok: true, stdout: 's "ignore"\n' } : { ok: false }; };
    machine.__clearLinuxReadingsForTests();
    const o = { platform: 'linux', claudeBin: process.execPath, tmuxBin: process.execPath, appDirs: [empty, empty], cacheInTest: true, now: () => t,
      linuxBoard: { unitFile: false, installed: null }, linuxSleepRead: counting };
    machine.check(o);
    const first = reads;
    machine.check(o);
    machine.sleepGate(o);
    assert.ok(first > 0, 'control: the first visit read logind');
    assert.equal(reads, first, 'the second visit and the gate used the kept reading');
    t += 10000;
    machine.check(o);
    assert.ok(reads > first, 'ten seconds later it reads again');
  } finally { machine.__clearLinuxReadingsForTests(); fs.rmSync(empty, { recursive: true, force: true }); }
});

test('boardAutostartCheck: a runner handed straight in is used, as on the Mac and Windows arms', () => {
  const got = withUnitDir(true, () => machine.boardAutostartCheck(() => ({ ok: true, stdout: 'UnitFileState=disabled\n' }), { platform: 'linux', installedRoot: BUNDLE }));
  assert.match(got.detail, /switched off/);
});

test('restart: systemd silent with the file in place reads linger, and linger off is the log-out answer with its command', () => {
  const asked = [];
  const runner = (c) => { asked.push(c); return c === 'loginctl' ? { ok: true, stdout: 'Linger=no\n' } : { ok: false }; };
  const got = withUnitDir(true, () => machine.readLinuxBoardAutostart(runner, { runner, installedRoot: BUNDLE, user: 'pat', systemdRunning: true }));
  assert.equal(got.unitState, null);
  assert.equal(got.linger, false);
  const r = row(got);
  assert.equal(r.state, STATE.ATTENTION);
  assert.equal(r.title, 'Kosmos will not start by itself after a restart', 'the board is running now, so the words are about after a restart');
  assert.match(r.detail, /so after a restart Kosmos and your agents stay stopped until someone logs in/);
  assert.equal(r.admin, "loginctl enable-linger 'pat'");
  // Control: linger on, and systemd still silent, is the plain could-not-check.
  assert.equal(row({ ...got, linger: true }).state, STATE.UNKNOWN);
});

test('sleep row: a lid inferred from a battery is hedged in the title too', () => {
  assert.equal(sleep({ idle: QUIET_IDLE, lid: { ac: 'suspend', battery: 'suspend', sure: false } }).title, 'This computer can go to sleep when its lid closes, if it has one');
  assert.equal(sleep({ idle: QUIET_IDLE, lid: { ac: 'suspend', battery: 'suspend', sure: true } }).title, 'This computer can go to sleep when its lid closes');
});

test('sleep reader: no gsettings program is a desktop we do not read, not a failed read', () => {
  const { runner } = sleepRunner({ IdleAction: 's "ignore"' });
  const missing = (c, a) => (c === 'gsettings' ? { ok: false, missing: true } : runner(c, a));
  const got = machine.readLinuxSleep({ runner: missing, hasLid: false, hasBattery: false });
  assert.equal(got.gnomeUnread, undefined);
  assert.notEqual(sleep(got).state, STATE.UNKNOWN);
  const failing = (c, a) => (c === 'gsettings' ? { ok: false } : runner(c, a));
  assert.equal(machine.readLinuxSleep({ runner: failing, hasLid: false, hasBattery: false }).gnomeUnread, 'ac', 'control: a failed read is unread');
});

test('sleep reader: a failed read that cannot change the answer is not could-not-check, and the half that failed is named', () => {
  // A desktop PC (no battery), plugged-in type 'nothing', its timeout read fails: fully known, so no could-not-check.
  const { runner } = sleepRunner({ IdleAction: 's "ignore"', 'sleep-inactive-ac-type': "'nothing'", 'sleep-inactive-ac-timeout': null });
  const desk = machine.readLinuxSleep({ runner, hasLid: false, hasBattery: false });
  assert.equal(desk.gnomeUnread, undefined);
  assert.equal(sleep(desk).state, STATE.OK);
  // The same failure behind a type that suspends is unread, and the words do not blame the battery.
  const lost = machine.readLinuxSleep({ runner: sleepRunner({ IdleAction: 's "ignore"', 'sleep-inactive-ac-timeout': null }).runner, hasLid: false, hasBattery: false });
  assert.equal(lost.gnomeUnread, 'ac');
  assert.doesNotMatch(sleep(lost).detail, /battery setting did not answer/);
});

test('sleep row: sleep plus restart says both in the closing sentence', () => {
  assert.match(sleep({ idle: { action: 'suspend', minutes: 30 }, lid: { ac: 'reboot', battery: 'reboot' } }).detail, /Your agents stop until it wakes or it has restarted\./);
  assert.match(sleep({ idle: { action: 'suspend', minutes: 30 }, gnome: { ac: 'reboot', acMinutes: 5, battery: null, batteryMinutes: null } }).detail, /Your agents stop until it wakes or it has restarted\./);
});

test('restart: the linger command keeps every user name, single-quoted, and the quoting holds when run', () => {
  const at = (user) => row({ unitFile: true, unitState: 'enabled', linger: false, installed: BUNDLE, user }).admin;
  assert.equal(at('pat'), "loginctl enable-linger 'pat'");
  assert.equal(at('pat@corp.example.com'), "loginctl enable-linger 'pat@corp.example.com'", 'a directory account keeps its name');
  // Run through sh with echo in place of loginctl: each name comes back as one word, unchanged.
  for (const name of ['CORP\\pat', "o'brien", 'pat; rm -rf ~', '$(whoami)']) {
    const out = require('node:child_process').execFileSync('/bin/sh', ['-c', at(name).replace(/^loginctl enable-linger/, 'printf %s')], { encoding: 'utf8' });
    assert.equal(out, name, name);
  }
});

test('restart: systemd silent and linger off says only the file was read', () => {
  const r = row({ unitFile: true, unitState: null, linger: false, installed: BUNDLE, user: 'pat' });
  assert.match(r.detail, /^Its startup file is on this computer/);
  assert.match(r.detail, /\(Whether the service is switched on could not be read\.\) You can let it keep running/);
  assert.doesNotMatch(r.detail, /until then/);
  assert.doesNotMatch(r.detail, /service is in place/);
});

test('sleep: on a logind with no HandleLidSwitchExternalPower (before systemd 235) the lid fix names HandleLidSwitch', () => {
  const { runner } = sleepRunner({ IdleAction: 's "ignore"', HandleLidSwitchExternalPower: null, gsd: 'inactive' });
  const got = machine.readLinuxSleep({ runner, hasLid: true });
  assert.equal(got.lid.noExt, true);
  assert.match(sleep(got).admin, /HandleLidSwitch=ignore\\n' > \/etc\/systemd\/logind\.conf\.d\/zz-kosmos-lid\.conf$/);
  assert.doesNotMatch(sleep(got).admin, /ExternalPower/);
});

test('sleep: on an older logind the one lid key covers battery too, and the words do not promise battery sleep', () => {
  const r = sleep({ idle: QUIET_IDLE, lid: { ac: 'suspend', battery: 'suspend', noExt: true } });
  assert.doesNotMatch(r.detail, /still puts it to sleep/);
  assert.match(r.detail, /On this computer that change also stops the lid putting it to sleep on battery\./);
  assert.match(sleep({ idle: QUIET_IDLE, lid: { ac: 'suspend', battery: 'suspend', noExt: false } }).detail, /still puts it to sleep, as it should/, 'control');
});

test('sleep reader: GNOME\'s service that could not be asked, with a desktop running, is unread, not quiet', () => {
  const { runner } = sleepRunner({ IdleAction: 's "ignore"' });
  const timedOut = (c, a) => {
    if (c === 'systemctl' && a[0] === '--user') return { ok: false, stdout: '' };            // no answer at all
    if (c === 'systemctl' && a[1] === 'display-manager.service') return { ok: true, stdout: 'active\n' };
    return runner(c, a);
  };
  const got = machine.readLinuxSleep({ runner: timedOut, hasLid: false });
  assert.equal(got.gnomeUnread, 'service');
  assert.equal(sleep(got).state, STATE.UNKNOWN);
  const inactive = (c, a) => (c === 'systemctl' && a[0] === '--user' ? { ok: false, stdout: 'inactive\n' } : timedOut(c, a));
  const quiet = machine.readLinuxSleep({ runner: inactive, hasLid: false });
  assert.equal(quiet.gnomeUnread, undefined, 'control: "inactive" is an answer');
  assert.equal(sleep(quiet).state, STATE.OK);
});

test('sleep reader: after one dead logind ask the rest are not asked; a property this logind lacks is not a dead bus', () => {
  const asked = [];
  const dead = (c, a) => { asked.push(a[5]); if (c !== 'busctl') return { ok: false }; return a[5] === 'IdleAction' ? { ok: true, stdout: 's "ignore"\n' } : { ok: false, because: 'Connection timed out' }; };
  machine.readLinuxSleep({ runner: dead, hasLid: true });
  assert.deepEqual(asked.filter(Boolean), ['IdleAction', 'IdleActionUSec'], 'stopped after the first dead ask');
  const asked2 = [];
  const old = (c, a) => { asked2.push(a[5]); if (c !== 'busctl') return { ok: false }; if (a[5] === 'HandleLidSwitchExternalPower') return { ok: false, because: 'Unknown property or interface.' }; return { ok: true, stdout: a[5] === 'IdleActionUSec' ? 't 0\n' : 's "suspend"\n' }; };
  const got = machine.readLinuxSleep({ runner: old, hasLid: true });
  assert.ok(asked2.includes('HandleLidSwitchDocked'), 'still asked after a missing property');
  assert.equal(got.lid.noExt, true);
});

test('restart: every reinstall sentence says Kosmos restarts for a moment, and claims nothing about the agents', () => {
  for (const r of [{ unitFile: false, installed: BUNDLE, systemdRunning: true }, { unitFile: true, unitState: 'disabled', installed: BUNDLE }, { unitFile: true, unitState: 'enabled-runtime', installed: BUNDLE }]) {
    assert.match(row(r).detail, /Reinstalling Kosmos [^.]*\(Kosmos restarts for a moment\)/, JSON.stringify(r));
  }
});

test('restart: the Mac arm\'s words are untouched by this Linux card', () => {
  const mac = machine.boardAutostartCheck(() => ({ ok: false }), { platform: 'darwin', installedRoot: '/Applications/Kosmos.app' });
  if (mac && /missing/.test(mac.detail)) assert.match(mac.detail, /Reinstalling Kosmos puts it back\.$/);
  const src = fs.readFileSync(path.join(__dirname, 'machine.js'), 'utf8');
  assert.ok(src.includes("come back on their own until it is restored. Reinstalling Kosmos puts it back.' };"), 'the Mac sentence as main has it');
});

test('restart: the enable command says whose account runs it', () => {
  for (const st of ['disabled', 'enabled-runtime']) {
    assert.match(row({ unitFile: true, unitState: st, installed: BUNDLE }).detail, /run the command under For IT admins from this account, not an administrator's\./, st);
  }
});

test('linuxLid: a lid listed with no battery (a desktop board) is not sure', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-8384-lid2-'));
  try {
    fs.mkdirSync(path.join(root, 'lid', 'LID0'), { recursive: true }); fs.mkdirSync(path.join(root, 'ps'));
    assert.deepEqual(machine.linuxLid(path.join(root, 'lid'), path.join(root, 'ps')), { has: true, sure: false });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('linuxRun: after one look times out, the rest fail at once, so a reading costs one timeout', () => {
  machine.setLinuxTimeoutForTests(200);
  try {
    const run = machine.__linuxRunForTests;
    const t0 = Date.now();
    const slow = run('/bin/sleep', ['2']);
    assert.equal(slow.ok, false);
    const t1 = Date.now();
    const next = run('/bin/sleep', ['2']);
    assert.equal(next.ok, false);
    assert.match(next.because, /timed out just now/);
    assert.ok(Date.now() - t1 < 100, 'the second fails at once');
    assert.ok(t1 - t0 < 1500, 'the first stops at the timeout');
  } finally { machine.setLinuxTimeoutForTests(2000); }
  assert.equal(machine.__linuxRunForTests('/bin/echo', ['ok']).stdout, 'ok\n', 'control: reset, it runs again');
});

test('sleep reader: a failed ExternalPower ask is not older systemd, and no lid fix is offered on a guess', () => {
  const lidOnly = (c, a) => {
    if (c !== 'busctl') return { ok: false };
    if (a[5] === 'HandleLidSwitchExternalPower') return { ok: false, because: 'Connection timed out' };
    return { ok: true, stdout: a[5] === 'IdleActionUSec' ? 't 0\n' : (a[5] === 'IdleAction' ? 's "ignore"\n' : 's "suspend"\n') };
  };
  const got = machine.readLinuxSleep({ runner: lidOnly, hasLid: true });
  assert.equal(got.lid.noExt, false);
  assert.equal(got.lid.extUnread, true);
  const r = sleep(got);
  assert.doesNotMatch(r.detail, /also stops the lid putting it to sleep on battery/);
  assert.equal(r.admin, undefined, 'no lid fix written on a guess');
});

test('sleep row: a lid finding with the plugged-in desktop setting unread makes no plugged-in promise', () => {
  for (const unread of ['service', 'ac']) {
    const r = sleep({ idle: QUIET_IDLE, lid: { ac: 'suspend', battery: 'suspend' }, gnome: null, gnomeUnread: unread });
    assert.equal(r.state, STATE.ATTENTION, String(unread));
    assert.equal(r.battOnly, undefined, 'not the battery-only kind: ' + unread);
    assert.doesNotMatch(r.detail, /Plugged in and open, it keeps working/, String(unread));
    assert.match(r.detail, unread === 'service'
      ? /We could not tell whether a desktop's own power settings put it to sleep while plugged in/
      : /own power settings could not be read, so we cannot tell whether it keeps working while plugged in/, String(unread));
  }
  // Control: only the battery half unread keeps the plugged-in promise, and says the part that was not read.
  const batt = sleep({ idle: QUIET_IDLE, lid: { ac: 'suspend', battery: 'suspend' }, gnome: { ac: 'nothing', acMinutes: 0 }, gnomeUnread: 'battery' });
  assert.equal(batt.battOnly, true);
  assert.match(batt.detail, /Plugged in and open, it keeps working.*Part of your desktop's power settings could not be read\.$/);
});

test('sleep reader: a failed ExternalPower ask words only the battery half of the lid', () => {
  const r = (c, a) => {
    if (c !== 'busctl') return { ok: false };
    if (a[5] === 'HandleLidSwitchExternalPower') return { ok: false, because: 'Connection timed out' };
    return { ok: true, stdout: a[5] === 'IdleActionUSec' ? 't 0\n' : (a[5] === 'IdleAction' ? 's "ignore"\n' : 's "suspend"\n') };
  };
  const got = machine.readLinuxSleep({ runner: r, hasLid: true });
  assert.equal(got.lid.ac, null);
  assert.match(sleep(got).detail, /^When the lid closes on battery, this computer goes to sleep\./);
});

test('sleep row: a non-GNOME desktop (display manager, nothing read) with a lid finding makes no plugged-in promise', () => {
  const r = sleep({ idle: QUIET_IDLE, lid: { ac: 'ignore', battery: 'suspend' }, gnome: null, desktop: true });
  assert.equal(r.battOnly, undefined);
  assert.doesNotMatch(r.detail, /Plugged in and open, it keeps working/);
  assert.equal(sleep({ idle: QUIET_IDLE, lid: { ac: 'ignore', battery: 'suspend' }, gnome: null, desktop: false }).battOnly, true, 'control: no desktop');
});

test('sleep reader: a lid whose setting could not be read is could-not-check, never an all-clear', () => {
  const r = (c, a) => {
    if (c === 'systemctl') return { ok: false, stdout: 'inactive\n' };
    if (c !== 'busctl') return { ok: false };
    if (a[5] === 'HandleLidSwitch') return { ok: false, because: 'Connection timed out' };
    return { ok: true, stdout: a[5] === 'IdleActionUSec' ? 't 0\n' : 's "ignore"\n' };
  };
  const got = machine.readLinuxSleep({ runner: r, hasLid: true });
  assert.equal(got.lidUnread, true);
  const row2 = sleep(got);
  assert.equal(row2.state, STATE.UNKNOWN);
  assert.match(row2.title, /could not read this computer's lid setting/);
  assert.deepEqual(machine.sleepGate({ platform: 'linux', linuxSleep: got }).checkable, false);
});

test('sleep reader: a hung bus before the desktop could be asked is unread, not quiet', () => {
  const hung = (c, a) => (c === 'busctl' ? { ok: true, stdout: a[5] === 'IdleActionUSec' ? 't 0\n' : 's "ignore"\n' } : { ok: false, stdout: '' });
  const got = machine.readLinuxSleep({ runner: hung, hasLid: false });
  assert.equal(got.desktop, null);
  assert.equal(got.gnomeUnread, 'service');
  assert.equal(sleep(got).state, STATE.UNKNOWN);
});

test('sleep reader: a lid with its plugged-in or docked half unread is could-not-check, not an all-clear', () => {
  const mk = (failKey) => (c, a) => {
    if (c === 'systemctl') return { ok: false, stdout: 'inactive\n' };
    if (c !== 'busctl') return { ok: false };
    if (a[5] === failKey) return { ok: false, because: 'Connection reset by peer' };
    if (a[5] === 'BlockInhibited') return { ok: true, stdout: 's "sleep:idle"\n' };
    return { ok: true, stdout: a[5] === 'IdleActionUSec' ? 't 0\n' : 's "ignore"\n' };
  };
  for (const key of ['HandleLidSwitchExternalPower', 'HandleLidSwitchDocked']) {
    const got = machine.readLinuxSleep({ runner: mk(key), hasLid: true });
    assert.equal(got.lidUnread, true, key);
    assert.equal(sleep(got).state, STATE.UNKNOWN, key);
  }
});

test('sleep: a desktop holding the lid inhibitor decides the lid; no logind lid finding or fix, and the row says so', () => {
  const r = (c, a) => {
    if (c === 'systemctl') return { ok: false, stdout: 'inactive\n' };
    if (c !== 'busctl') return { ok: false };
    if (a[5] === 'BlockInhibited') return { ok: true, stdout: 's "handle-power-key:handle-suspend-key:handle-lid-switch"\n' };
    return { ok: true, stdout: a[5] === 'IdleActionUSec' ? 't 0\n' : (a[5] === 'IdleAction' ? 's "ignore"\n' : 's "suspend"\n') };
  };
  const got = machine.readLinuxSleep({ runner: r, hasLid: true });
  assert.equal(got.lid.desktopHandles, true);
  const row2 = sleep(got);
  assert.equal(row2.state, STATE.OK);
  assert.equal(row2.admin, undefined);
  assert.match(row2.detail, /What closing the lid does is up to your desktop, which holds it right now \(this can change when another screen is connected or removed\)\./);
  // Control: the same logind answers without the inhibitor are the lid finding.
  const plain = (c, a) => (c === 'busctl' && a[5] === 'BlockInhibited' ? { ok: true, stdout: 's "sleep"\n' } : r(c, a));
  assert.equal(sleep(machine.readLinuxSleep({ runner: plain, hasLid: true })).state, STATE.ATTENTION);
});

test('sleep row: with no desktop seen, could-not-check does not say a desktop is running', () => {
  const got = sleep({ idle: QUIET_IDLE, lid: null, gnome: null, desktop: null, gnomeUnread: 'service' });
  assert.match(got.detail, /^We could not tell whether this computer has a desktop/);
  assert.doesNotMatch(got.detail, /Your desktop is running/);
});

test('restart row: a look skipped after another timed out says it did not get to ask', () => {
  const got = withUnitDir(true, () => machine.readLinuxBoardAutostart(() => ({ ok: false, because: 'skipped: a Linux look timed out just now', stdout: '' }),
    { runner: () => ({ ok: false, because: 'skipped: a Linux look timed out just now', stdout: '' }), installedRoot: BUNDLE, lingerOn: true }));
  assert.equal(got.skipped, true);
  assert.match(row(got).detail, /were slow to answer, so we did not ask about Kosmos's startup service; it is asked again on the next visit/);
});

test('a reading made while a look has timed out is not kept, so the next visit reads again', () => {
  machine.setLinuxTimeoutForTests(150);
  let reads = 0;
  const key = 'hung-' + Math.random();
  try {
    machine.__linuxRunForTests('/bin/sleep', ['2']);   // trips the shared timeout memory
    machine.linuxCached(key, { cacheInTest: true }, () => { reads += 1; return {}; });
    machine.linuxCached(key, { cacheInTest: true }, () => { reads += 1; return {}; });
    assert.equal(reads, 2, 'not kept while the bus is hung');
  } finally { machine.setLinuxTimeoutForTests(2000); }
  machine.linuxCached(key, { cacheInTest: true }, () => { reads += 1; return {}; });
  machine.linuxCached(key, { cacheInTest: true }, () => { reads += 1; return {}; });
  assert.equal(reads, 3, 'control: kept again once the memory is clear');
});

test('sleep row: a lid that sleeps only when docked says so in the title', () => {
  assert.equal(sleep({ idle: QUIET_IDLE, lid: { ac: 'ignore', battery: 'ignore', docked: 'suspend' } }).title,
    'This computer can go to sleep when its lid closes with another screen connected');
});

test('the readers stand down in a child process a test spawns, not only in the test process', () => {
  // A busctl on PATH that says "suspend", so a host read would show on any machine (a Mac has no busctl of its own).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-8384-child-'));
  try {
    fs.writeFileSync(path.join(dir, 'busctl'), '#!/bin/sh\ncase "$*" in *USec*) echo "t 1800000000";; *) echo \'s "suspend"\';; esac\n', { mode: 0o755 });
    // Every other command the reader runs is faked too, so the control child reads nothing of the host either.
    fs.writeFileSync(path.join(dir, 'systemctl'), '#!/bin/sh\necho inactive\nexit 3\n', { mode: 0o755 });
    fs.writeFileSync(path.join(dir, 'gsettings'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const script = "const m=require(" + JSON.stringify(path.join(__dirname, 'machine.js')) + "); process.stdout.write(JSON.stringify(m.readLinuxSleep({ hasLid: false, lidSure: true, hasBattery: false })))";
    const env = { ...process.env, PATH: dir + path.delimiter + process.env.PATH };
    const child = (extra) => JSON.parse(require('node:child_process').execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', env: { ...env, ...extra } }));
    assert.deepEqual(child({ NODE_TEST_CONTEXT: 'child-v8' }), { idle: null, lid: null, gnome: null, desktop: null });
    // Control: the same child outside a test run does read, through the fake.
    const env2 = { ...env }; delete env2.NODE_TEST_CONTEXT;
    const outside = JSON.parse(require('node:child_process').execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', env: env2 }));
    assert.deepEqual(outside.idle, { action: 'suspend', minutes: 30 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('restart: a loose board (running, not by systemd) with linger off says it will not start after a restart, as setup.sh does', () => {
  const r = row({ unitFile: true, unitState: 'enabled', linger: false, held: false, installed: BUNDLE, user: 'pat' });
  assert.equal(r.title, 'Kosmos will not start by itself after a restart');
  assert.match(r.detail, /It is running now and usually keeps running when you log out, but after this computer restarts it starts only when you log in.*a container's own rule say, that decides instead/);
  assert.equal(row({ unitFile: true, unitState: 'enabled', linger: false, held: true, installed: BUNDLE }).title, 'Kosmos stops when you log out', 'control: held');
  const runner = (c) => (c === 'systemctl' ? { ok: true, stdout: 'UnitFileState=enabled\nMainPID=4242\n' } : { ok: true, stdout: 'Linger=no\n' });
  const got = withUnitDir(true, () => machine.readLinuxBoardAutostart(runner, { runner, installedRoot: BUNDLE, pid: 999 }));
  assert.equal(got.held, false);
  const got2 = withUnitDir(true, () => machine.readLinuxBoardAutostart(runner, { runner, installedRoot: BUNDLE, pid: 4242 }));
  assert.equal(got2.held, true);
});

test('sleep reader: nobody logged in (no user bus) means GNOME is not running, not an unread desktop', () => {
  const r = (c, a) => {
    if (c === 'systemctl' && a[0] === '--user') return { ok: false, stdout: '', because: 'Failed to connect to bus: No medium found' };
    if (c === 'systemctl' && a[1] === 'display-manager.service') return { ok: true, stdout: 'active\n' };
    if (c === 'busctl') return { ok: true, stdout: a[5] === 'IdleActionUSec' ? 't 0\n' : 's "ignore"\n' };
    return { ok: false };
  };
  const got = machine.readLinuxSleep({ runner: r, hasLid: false });
  assert.equal(got.gnomeUnread, undefined);
  const row2 = sleep(got);
  assert.equal(row2.state, STATE.OK, 'the logged-out desktop row, as decided');
  assert.doesNotMatch(row2.detail, /Your desktop is running/);
});

test('sleep reader: a reading with skipped looks is could-not-check for now, never an absent row', () => {
  const skip = () => ({ ok: false, because: 'skipped: a Linux look timed out just now', stdout: '' });
  const got = machine.readLinuxSleep({ runner: skip, hasLid: true });
  assert.equal(got.skipped, true);
  const row2 = sleep(got);
  assert.notEqual(row2, null);
  assert.equal(row2.state, STATE.UNKNOWN);
  assert.match(row2.detail, /slow to answer, so not every one was asked; they are asked again on the next visit/);
});

test('sleep: a desktop not ruled out (its ask failed) gets no plugged-in promise and the gate does not pass it', () => {
  const r = sleep({ idle: QUIET_IDLE, lid: { ac: 'ignore', battery: 'suspend' }, gnome: null, desktop: null });
  assert.equal(r.battOnly, undefined);
  assert.equal(machine.sleepGate({ platform: 'linux', linuxSleep: { idle: QUIET_IDLE, lid: null, gnome: null, desktop: null } }).checkable, false);
  assert.equal(machine.sleepGate({ platform: 'linux', linuxSleep: { idle: QUIET_IDLE, lid: null, gnome: null, desktop: false } }).prevented, true, 'control');
});

test('linuxRun: two looks in a row slower than half the timeout trip the memory; one slow look alone does not', () => {
  machine.setLinuxTimeoutForTests(1500);
  try {
    assert.equal(machine.__linuxRunForTests('/bin/sleep', ['0.9']).ok, true, 'one slow look answers');
    assert.equal(machine.__linuxRunForTests('/bin/echo', ['x']).ok, true, 'and does not trip the memory on its own');
    machine.__linuxRunForTests('/bin/sleep', ['0.9']);
    machine.__linuxRunForTests('/bin/sleep', ['0.9']);
    assert.match(String(machine.__linuxRunForTests('/bin/echo', ['x']).because), /timed out just now/, 'two in a row do');
  } finally { machine.setLinuxTimeoutForTests(2000); }
});

test('sleep reader: other "no user session" texts from systemctl also mean GNOME is not running', () => {
  for (const why of ['Failed to connect to user scope bus via local transport: Connection refused', 'Failed to connect to bus: No such file or directory']) {
    const r = (c, a) => {
      if (c === 'systemctl' && a[0] === '--user') return { ok: false, stdout: '', because: why };
      if (c === 'systemctl' && a[1] === 'display-manager.service') return { ok: true, stdout: 'active\n' };
      if (c === 'busctl') return { ok: true, stdout: a[5] === 'IdleActionUSec' ? 't 0\n' : 's "ignore"\n' };
      return { ok: false };
    };
    assert.equal(sleep(machine.readLinuxSleep({ runner: r, hasLid: false })).state, STATE.OK, why);
  }
});
