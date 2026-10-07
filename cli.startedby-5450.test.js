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
async function boardRun(mark) {
  const port = await closedPort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-5450-home-'));
  try {
    fs.mkdirSync(path.join(home, 'tmux', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(home, 'tmux', 'bin', 'tmux'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const node = path.join(home, 'fake-node');
    fs.writeFileSync(node, '#!/bin/sh\nenv > "$KOSMOS_HOME/board-env.txt"\n', { mode: 0o755 });
    const app = path.join(home, 'server.js'); fs.writeFileSync(app, '');
    const markFile = path.join(home, 'board.person-start');
    if (mark !== undefined) fs.writeFileSync(markFile, mark);
    const env = { ...process.env, KOSMOS_PORT: String(port), KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_HOME: home,
      AGENT_WORKFORCE_DATA: path.join(home, 'data'), AGENT_WORKFORCE_WORKERS: path.join(home, 'workers') };
    delete env.KOSMOS_AGENT_SESSION; delete env.KOSMOS_AGENT_TOKEN; delete env.TMUX_PANE; delete env.KOSMOS_BOARD_STARTED_BY;
    const out = await bash(`source "${CLI}"; NODE="${node}"; APP="${app}"; cmd_board_run`, env);
    const got = fs.existsSync(path.join(home, 'board-env.txt')) ? fs.readFileSync(path.join(home, 'board-env.txt'), 'utf8') : '';
    assert.ok(got, 'board-run must launch the stub board, or the arm measures nothing: ' + out.stdout + out.stderr);
    const by = (got.match(/^KOSMOS_BOARD_STARTED_BY=(.*)$/m) || [])[1];
    return { by, markLeft: fs.existsSync(markFile) };
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}

test('#5450: board-run with no mark says the supervisor started it (the login item, or a crash relaunch)', async () => {
  assert.deepEqual(await boardRun(undefined), { by: 'supervisor', markLeft: false });
});

test('#5450: a fresh mark from `kosmos start` says a person started it, and is consumed', async () => {
  assert.deepEqual(await boardRun(String(Math.floor(Date.now() / 1000))), { by: 'person', markLeft: false });
});

test('#5450: a stale or unreadable mark is not a person, and is consumed too', async () => {
  assert.deepEqual(await boardRun(String(Math.floor(Date.now() / 1000) - 3600)), { by: 'supervisor', markLeft: false }, 'an hour-old mark');
  assert.deepEqual(await boardRun('not a time'), { by: 'supervisor', markLeft: false }, 'a mark that is not a time');
});

test('#5450: `kosmos start` leaves the mark before it kickstarts, and a direct start says person (source pins)', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  const kick = src.indexOf('kickstart -k "gui/$_sup_uid/$_sup_label"');
  assert.ok(kick > -1, 'the supervised start is not where this pin looks');
  const before = src.slice(src.lastIndexOf('_mark_board_started', kick), kick);
  assert.match(before, /date \+%s > "\$PERSON_START_FILE"/, 'the mark is not written before the kickstart');
  assert.match(src, /KOSMOS_BOARD_STARTED_BY=person nohup "\$NODE" "\$APP"/, 'a direct start does not say person');
});
