'use strict';
/**
 * kosmos#6667: the board's pause check on Linux (engine/linuxboard.js pauseCheckNames, pauseCheckUnitsFor, and their
 * place in installBoard and removeBoard), without touching real systemd. What `kosmos board-revive` decides is
 * tools/test-board-revive-6667.sh; the live run on real systemd is tools/test-linux-pause-check-live-6667.sh.
 *
 *   node --test engine/linuxboard.pausecheck-6667.test.js
 */
const test = require('node:test');
{
  const sbx = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'aw-pausecheck6667-'));
  process.env.AGENT_WORKFORCE_DATA = require('node:path').join(sbx, 'data');
  process.env.AGENT_WORKFORCE_WORKERS = require('node:path').join(sbx, 'workers');
  process.on('exit', () => { try { require('node:fs').rmSync(sbx, { recursive: true, force: true }); } catch { /* temp */ } });
}
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const linuxboard = require('./linuxboard');

test.afterEach(() => {
  linuxboard.setRunnerForTests(null);
  linuxboard.setSystemdDirForTests(null);
});

function sandbox(prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  linuxboard.setSystemdDirForTests(() => tmp);
  const home = path.join(tmp, 'kosmos-home');
  fs.mkdirSync(home, { recursive: true });
  return { tmp, home };
}

test('the pause check is named from the board unit, and never as a board unit', () => {
  const def = path.join(os.homedir(), '.local', 'share', 'kosmos');
  assert.deepEqual(linuxboard.pauseCheckNames(def), { service: 'kosmos-pause-check.service', timer: 'kosmos-pause-check.timer' });
  const other = '/srv/kosmos-other';
  const hash = linuxboard.boardUnitName(other).match(/^kosmos-board\.([0-9a-f]{8})\.service$/)[1];
  assert.deepEqual(linuxboard.pauseCheckNames(other), {
    service: `kosmos-pause-check.${hash}.service`,
    timer: `kosmos-pause-check.${hash}.timer`,
  });
  // setup.sh's uninstall names every other kosmos-board*.service as another install's board.
  assert.doesNotMatch(linuxboard.pauseCheckNames(other).service, /^kosmos-board/);
});

test('the pause check runs kosmos board-revive once a minute, and is not a keep-alive', () => {
  const home = '/home/user/.local/share/kosmos-x';
  const { names, service, timer } = linuxboard.pauseCheckUnitsFor(home);
  assert.match(service, /^Type=oneshot$/m);
  assert.match(service, new RegExp('^ExecStart=/bin/bash "' + home + '/bin/kosmos" board-revive$', 'm'));
  assert.match(service, new RegExp('^Environment="KOSMOS_HOME=' + home + '"$', 'm'));
  assert.doesNotMatch(service, /^Restart=/m, 'a oneshot check is never restarted');
  assert.doesNotMatch(service, /^\[Install\]/m, 'only the timer is enabled');
  assert.match(timer, /^OnCalendar=minutely$/m);
  assert.match(timer, new RegExp('^Unit=' + names.service.replace(/\./g, '\\.') + '$', 'm'));
  assert.match(timer, /^WantedBy=timers\.target$/m);
});

test('a Kosmos folder that would add a directive is refused for the pause check too', () => {
  assert.throws(() => linuxboard.pauseCheckUnitsFor('/home/user/kos\nExecStartPre=/bin/false'));
});

test('installBoard writes the pause check and enables its timer after the board', () => {
  const calls = [];
  linuxboard.setRunnerForTests((cmd, args) => { calls.push(args.join(' ')); return { ok: true, stdout: '' }; });
  const { tmp, home } = sandbox('pausecheck-install-');
  try {
    const r = linuxboard.installBoard(home, 17000);
    assert.equal(r.ok, true);
    assert.deepEqual(r.pauseCheck, { ok: true });
    const names = linuxboard.pauseCheckNames(home);
    assert.equal(fs.readFileSync(path.join(tmp, names.service), 'utf8'), linuxboard.pauseCheckUnitsFor(home).service);
    assert.equal(fs.readFileSync(path.join(tmp, names.timer), 'utf8'), linuxboard.pauseCheckUnitsFor(home).timer);
    const board = calls.indexOf('--user enable ' + linuxboard.boardUnitName(home));
    const timer = calls.indexOf('--user enable --now ' + names.timer);
    assert.ok(calls.indexOf('--user daemon-reload') === 0, calls.join(' | '));
    assert.ok(board > 0 && timer > board, 'the timer is enabled after the board: ' + calls.join(' | '));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a refused pause-check timer does not fail the board install, and says why', () => {
  linuxboard.setRunnerForTests((cmd, args) => (args.includes('--now')
    ? { ok: false, stdout: '', stderr: 'Failed to enable unit: no\n' }
    : { ok: true, stdout: '' }));
  const { tmp, home } = sandbox('pausecheck-refused-');
  try {
    const r = linuxboard.installBoard(home, 17000);
    assert.equal(r.ok, true, 'the board is installed');
    assert.equal(r.pauseCheck.ok, false);
    assert.match(r.pauseCheck.because, /kosmos-pause-check\.[0-9a-f]{8}\.timer.*Failed to enable unit: no/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('removeBoard removes the pause check first, then the board', () => {
  const calls = [];
  linuxboard.setRunnerForTests((cmd, args) => { calls.push(args.join(' ')); return { ok: true, stdout: '' }; });
  const { tmp, home } = sandbox('pausecheck-remove-');
  try {
    const names = linuxboard.pauseCheckNames(home);
    for (const f of [linuxboard.boardUnitName(home), names.service, names.timer]) fs.writeFileSync(path.join(tmp, f), 'x');
    const r = linuxboard.removeBoard(home);
    assert.equal(r.ok, true);
    for (const f of [linuxboard.boardUnitName(home), names.service, names.timer]) {
      assert.equal(fs.existsSync(path.join(tmp, f)), false, f + ' was left');
    }
    const timer = calls.indexOf('--user disable --now ' + names.timer);
    const board = calls.indexOf('--user stop ' + linuxboard.boardUnitName(home));
    assert.ok(timer >= 0 && board > timer, 'the pause check goes before the board stops: ' + calls.join(' | '));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
