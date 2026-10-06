'use strict';
/**
 * #4918: Linux systemd board self-restart guard.
 *
 * Verifies that board self-restart fails safe on Linux unless a valid systemd
 * user unit is confirmed and running as this process.
 *
 *   node --test engine/boardrestart.linux-4918.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const board = require('./boardrestart');
const linuxboard = require('./linuxboard');

test.afterEach(() => {
  linuxboard.setRunnerForTests(null);
  linuxboard.setSystemdDirForTests(null);
  board.setInstalledCli(null);
});

test('canSelfRestart(linux) TRUE when running as systemd user service', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'systemd-can-restart-'));
  try {
    linuxboard.setSystemdDirForTests(() => tmp);
    const unitFile = linuxboard.boardUnitPath();
    fs.mkdirSync(path.dirname(unitFile), { recursive: true });
    fs.writeFileSync(unitFile, 'dummy', 'utf8');

    linuxboard.setRunnerForTests((cmd, args) => {
      if (args[1] === 'show') {
        return {
          ok: true,
          stdout: `MainPID=${process.pid}\nActiveState=active`,
        };
      }
      return { ok: true, stdout: '' };
    });

    const r = board.canSelfRestart('linux');
    assert.equal(r.canRestart, true);
    assert.equal(r.via, 'systemd');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('canSelfRestart(linux) FALSE when unit file is missing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'systemd-no-unit-'));
  try {
    linuxboard.setSystemdDirForTests(() => tmp);
    const r = board.canSelfRestart('linux');
    assert.equal(r.canRestart, false);
    assert.match(r.because, /no systemd user service/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('canSelfRestart(linux) falls back to kosmos restart when installed CLI is present', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'systemd-cli-fallback-'));
  try {
    linuxboard.setSystemdDirForTests(() => tmp);
    board.setInstalledCli('/usr/local/bin/kosmos');

    const r = board.canSelfRestart('linux');
    assert.equal(r.canRestart, true);
    assert.equal(r.via, 'kosmos');
    assert.equal(r.cli, '/usr/local/bin/kosmos');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('selfRestart(linux) invokes systemctl restart when via is systemd', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'systemd-self-restart-'));
  try {
    linuxboard.setSystemdDirForTests(() => tmp);
    const unitFile = linuxboard.boardUnitPath();
    fs.mkdirSync(path.dirname(unitFile), { recursive: true });
    fs.writeFileSync(unitFile, 'dummy', 'utf8');

    const calls = [];
    linuxboard.setRunnerForTests((cmd, args) => {
      calls.push({ cmd, args });
      if (args[1] === 'show') {
        return {
          ok: true,
          stdout: `MainPID=${process.pid}\nActiveState=active`,
        };
      }
      return { ok: true, stdout: '' };
    });

    const r = board.selfRestart('linux');
    assert.equal(r.ok, true);
    const lastCall = calls[calls.length - 1];
    assert.deepEqual(lastCall, {
      cmd: 'systemctl',
      args: ['--user', 'restart', '--no-block', linuxboard.boardUnitName()],
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
