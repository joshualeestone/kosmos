'use strict';
/**
 * #5450: board-run tells the board who started it, for the restart note (engine/restartnote.js): the supervisor (the
 * login item, or a crash relaunch) unless `kosmos start` left its fresh mark just before kickstarting the supervised
 * board, and a direct start always says person. Harness as cli.busy-health-4466.test.js's board-run arm: a fake node
 * that writes its environment.
 *
 *   node --test cli.startedby-5450.test.js
 */
require('./test-support/tmpscope');   // #4273: first, so every temp dir this file makes is contained and removed
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');

function bash(script, env, timeout = 40000) {
  return new Promise((resolve, reject) => {
    execFile('/bin/bash', ['-c', script], { env, timeout }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('bash gave no exit code (' + (err.signal || err.code) + ') ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}
async function closedPort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}

/* Runs board-run once in a fresh home, with `mark` (or nothing) in board.person-start, and returns what the stub board
   was started with and whether the mark is left. */
async function boardRun(mark, { mode } = {}) {
  const port = await closedPort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-5450-home-'));
  try {
    fs.mkdirSync(path.join(home, 'tmux', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(home, 'tmux', 'bin', 'tmux'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const node = path.join(home, 'fake-node');
    fs.writeFileSync(node, '#!/bin/sh\nenv > "$KOSMOS_HOME/board-env.txt"\n', { mode: 0o755 });
    const app = path.join(home, 'server.js'); fs.writeFileSync(app, '');
    const markFile = path.join(home, 'board.person-start');
    if (mark !== undefined) fs.writeFileSync(markFile, mark, mode === undefined ? undefined : { mode });
    const env = { ...process.env, KOSMOS_PORT: String(port), KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_HOME: home,
      AGENT_WORKFORCE_DATA: path.join(home, 'data'), AGENT_WORKFORCE_WORKERS: path.join(home, 'workers') };
    delete env.KOSMOS_AGENT_SESSION; delete env.KOSMOS_AGENT_TOKEN; delete env.TMUX_PANE; delete env.KOSMOS_BOARD_STARTED_BY;
    const out = await bash(`source "${CLI}"; NODE="${node}"; APP="${app}"; cmd_board_run`, env);
    const got = fs.existsSync(path.join(home, 'board-env.txt')) ? fs.readFileSync(path.join(home, 'board-env.txt'), 'utf8') : '';
    assert.ok(got, 'board-run must launch the stub board, or the arm measures nothing: ' + out.stdout + out.stderr);
    const by = (got.match(/^KOSMOS_BOARD_STARTED_BY=(.*)$/m) || [])[1];
    const markPath = (got.match(/^KOSMOS_BOARD_PERSON_MARK=(.*)$/m) || [])[1];
    assert.equal(markPath, markFile, 'the board is not told where the mark is, so it cannot consume it');
    return { by, markLeft: fs.existsSync(markFile), code: out.code };
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}

test('#5450: board-run with no mark says the supervisor started it (the login item, or a crash relaunch)', async () => {
  assert.deepEqual(await boardRun(undefined), { by: 'supervisor', markLeft: false, code: 0 });
});

test('#5450: a fresh mark from `kosmos start` says a person started it, and is LEFT for the board to consume', async () => {
  // Review 1: deleted here, a board that died before reading it would be relaunched as the supervisor's: a false note.
  assert.deepEqual(await boardRun(String(Math.floor(Date.now() / 1000))), { by: 'person', markLeft: true, code: 0 });
});

test('#5450: a stale, unparsable, future or oversized mark is not a person, and is removed', async () => {
  const now = Math.floor(Date.now() / 1000);
  assert.deepEqual(await boardRun(String(now - 3600)), { by: 'supervisor', markLeft: false, code: 0 }, 'an hour-old mark');
  assert.deepEqual(await boardRun('not a time'), { by: 'supervisor', markLeft: false, code: 0 }, 'a mark that is not a time');
  assert.deepEqual(await boardRun(String(now + 86400)), { by: 'supervisor', markLeft: false, code: 0 }, 'a mark from the future (a clock set back)');
  assert.deepEqual(await boardRun('0999999999'), { by: 'supervisor', markLeft: false, code: 0 }, 'a leading zero (bash read it as octal and stopped)');
  assert.deepEqual(await boardRun('9'.repeat(23)), { by: 'supervisor', markLeft: false, code: 0 }, 'a number too big for bash');
});

test('#5450 review 1: an unreadable mark never stops board-run (set -e): the board still starts, as the supervisor\'s', async (t) => {
  if (process.getuid && process.getuid() === 0) { t.skip('root reads a mode-000 file'); return; }
  const r = await boardRun(String(Math.floor(Date.now() / 1000)), { mode: 0o000 });
  assert.equal(r.code, 0);
  assert.equal(r.by, 'supervisor');
});

test('#5450: `kosmos start` marks a person\'s start, the watchdog\'s says supervisor, and stop clears the mark (source pins)', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  const kick = src.indexOf('kickstart -k "gui/$_sup_uid/$_sup_label"');
  assert.ok(kick > -1, 'the supervised start is not where this pin looks');
  const before = src.slice(src.lastIndexOf('_mark_board_started', kick), kick);
  assert.match(before, /if \[ "\$\{KOSMOS_START_BY:-\}" != supervisor \]; then date \+%s > "\$PERSON_START_FILE"/, 'the mark is not written (only for a person) before the kickstart');
  assert.match(src, /\[ "\$\{KOSMOS_START_BY:-\}" = supervisor \] && _start_by=supervisor/, 'the direct start ignores the watchdog');
  assert.match(src, /KOSMOS_BOARD_STARTED_BY="\$_start_by" nohup "\$NODE" "\$APP"/);
  assert.match(src, /rm -f "\$PERSON_START_FILE" 2>\/dev\/null \|\| true   # #5450: a start's mark does not outlive a deliberate stop/);
  // Review 1: the watchdog brings back a board nobody stopped: both of its starts say supervisor.
  const wd = fs.readFileSync(path.join(__dirname, 'bin', 'board-watchdog.sh'), 'utf8');
  const starts = wd.split('\n').filter((l) => /bash "\$KOSMOS_BIN" start --force/.test(l));
  assert.equal(starts.length, 2, 'the watchdog\'s starts are not where this pin looks: ' + starts.join(' | '));
  for (const l of starts) assert.match(l, /KOSMOS_START_BY=supervisor/, 'a watchdog start reads as a person\'s: ' + l);
});
