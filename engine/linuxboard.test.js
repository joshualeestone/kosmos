'use strict';
/**
 * #4918: unit tests for Linux systemd board supervision (engine/linuxboard.js).
 *
 * Verifies board unit generation, installation, removal, status inspection,
 * and self-restart qualification without touching real systemd.
 *
 *   node --test engine/linuxboard.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const linuxboard = require('./linuxboard');

test.afterEach(() => {
  linuxboard.setRunnerForTests(null);
  linuxboard.setSystemdDirForTests(null);
});

test('boardUnitName and boardUnitPath derive correct service names', () => {
  const defaultHome = path.join(process.env.HOME || '', '.local', 'share', 'kosmos');
  const u = linuxboard.boardUnitName(defaultHome);
  assert.equal(u, 'kosmos-board.service');

  const customHome = '/opt/custom/kosmos-home';
  const uCustom = linuxboard.boardUnitName(customHome);
  assert.equal(uCustom, 'kosmos-board.9311ef97.service');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'systemd-board-'));
  try {
    linuxboard.setSystemdDirForTests(() => tmp);
    const p = linuxboard.boardUnitPath(defaultHome);
    assert.equal(p, path.join(tmp, 'kosmos-board.service'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('boardUnitFor generates systemd unit with ConditionPathExists and board-run', () => {
  const home = '/home/user/.local/share/kosmos';
  const content = linuxboard.boardUnitFor(home, 16180);

  assert.match(content, /^\[Unit\]/m);
  assert.match(content, /^Description=Kosmos Board/m);
  assert.match(content, /^ConditionPathExists=!\/home\/user\/\.local\/share\/kosmos\/board\.stopped/m);
  assert.match(content, /^\[Service\]/m);
  assert.match(content, /^ExecStart=\/bin\/bash "\/home\/user\/\.local\/share\/kosmos\/bin\/kosmos" board-run/m);
  assert.match(content, /^WorkingDirectory=\/home\/user\/\.local\/share\/kosmos/m);
  assert.match(content, /^Environment="KOSMOS_HOME=\/home\/user\/\.local\/share\/kosmos"/m);
  assert.match(content, /^Environment="PATH=\/home\/user\/\.local\/share\/kosmos\/tmux\/bin:\/usr\/local\/bin:\/usr\/bin:\/bin:\/usr\/sbin:\/sbin"/m);
  assert.match(content, /^Environment="LANG=C\.UTF-8"/m);
  assert.match(content, /^Environment="KOSMOS_PORT=16180"/m);
  assert.match(content, /^Environment="PORT=16180"/m);
  assert.match(content, /^Restart=always/m);
  assert.match(content, /^RestartSec=5/m);
  assert.match(content, /^\[Install\]/m);
  assert.match(content, /^WantedBy=default\.target/m);
});

test('installBoard writes unit file and enables systemd service', () => {
  const calls = [];
  linuxboard.setRunnerForTests((cmd, args) => {
    calls.push({ cmd, args });
    return { ok: true, stdout: '' };
  });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'systemd-board-install-'));
  try {
    linuxboard.setSystemdDirForTests(() => tmp);
    const home = path.join(tmp, 'kosmos-home');
    fs.mkdirSync(home, { recursive: true });

    linuxboard.installBoard(home, 17000);

    const unitFile = linuxboard.boardUnitPath(home);
    assert.equal(fs.existsSync(unitFile), true);
    const content = fs.readFileSync(unitFile, 'utf8');
    assert.match(content, /PORT=17000/);

    assert.deepEqual(calls[0], {
      cmd: 'systemctl',
      args: ['--user', 'daemon-reload'],
    });
    assert.deepEqual(calls[1], {
      cmd: 'systemctl',
      args: ['--user', 'enable', linuxboard.boardUnitName(home)],
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('removeBoard stops, disables, deletes unit and reloads daemon', () => {
  const calls = [];
  linuxboard.setRunnerForTests((cmd, args) => {
    calls.push({ cmd, args });
    return { ok: true, stdout: '' };
  });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'systemd-board-remove-'));
  try {
    linuxboard.setSystemdDirForTests(() => tmp);
    const home = path.join(tmp, 'kosmos-home');
    fs.mkdirSync(home, { recursive: true });

    const unitFile = linuxboard.boardUnitPath(home);
    fs.writeFileSync(unitFile, 'dummy', 'utf8');
    assert.equal(fs.existsSync(unitFile), true);

    linuxboard.removeBoard(home);

    assert.equal(fs.existsSync(unitFile), false);
    assert.deepEqual(calls[0], {
      cmd: 'systemctl',
      args: ['--user', 'stop', linuxboard.boardUnitName(home)],
    });
    assert.deepEqual(calls[1], {
      cmd: 'systemctl',
      args: ['--user', 'disable', linuxboard.boardUnitName(home)],
    });
    assert.deepEqual(calls[2], {
      cmd: 'systemctl',
      args: ['--user', 'daemon-reload'],
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('loadedBoardJob parses active and PID correctly', () => {
  linuxboard.setRunnerForTests((cmd, args) => {
    return {
      ok: true,
      stdout: `● kosmos-board.service - Kosmos Board
     Loaded: loaded (/home/user/.config/systemd/user/kosmos-board.service; enabled)
     Active: active (running) since Wed 2026-10-01 22:00:00 CDT
   Main PID: 4242 (node)
`,
    };
  });

  const job = linuxboard.loadedBoardJob();
  assert.equal(job.ok, true);
  assert.equal(job.active, true);
  assert.equal(job.pid, 4242);
});

test('canRestart checks unit file existence, status and PID matching', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'systemd-board-restart-'));
  try {
    linuxboard.setSystemdDirForTests(() => tmp);
    const home = path.join(tmp, 'kosmos-home');
    fs.mkdirSync(home, { recursive: true });

    // 1. Unit file missing -> false
    const r1 = linuxboard.canRestart(home);
    assert.equal(r1.canRestart, false);
    assert.match(r1.because, /no systemd user service/);

    // Write dummy unit file
    const unitFile = linuxboard.boardUnitPath(home);
    fs.writeFileSync(unitFile, 'dummy', 'utf8');

    // 2. Status fails -> false
    linuxboard.setRunnerForTests(() => ({ ok: false }));
    const r2 = linuxboard.canRestart(home);
    assert.equal(r2.canRestart, false);
    assert.match(r2.because, /could not read systemd board service status/);

    // 3. PID mismatch -> false
    linuxboard.setRunnerForTests(() => ({
      ok: true,
      stdout: 'Main PID: 99999\nActive: active (running)',
    }));
    const r3 = linuxboard.canRestart(home);
    assert.equal(r3.canRestart, false);
    assert.match(r3.because, /not the running systemd board service/);

    // 4. PID matches process.pid -> true
    linuxboard.setRunnerForTests(() => ({
      ok: true,
      stdout: `Main PID: ${process.pid}\nActive: active (running)`,
    }));
    const r4 = linuxboard.canRestart(home);
    assert.equal(r4.canRestart, true);
    assert.equal(r4.via, 'systemd');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
