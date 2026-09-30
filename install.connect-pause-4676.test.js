'use strict';
require('./test-support/tmpscope');
/* #4676: a computer set to connect (#4356) must be able to update while ANOTHER install's
 * board holds the port.
 *
 * The update's pause printed its own promise, "another Kosmos is answering on port N; it is
 * not this install's ... so it is left alone", then fell into the "gone by port" wait, which
 * saw that same board for ten seconds and stopped the update telling the person to kill it.
 * On a shared Mac a connect computer could never update with the install line.
 *
 * The pause block is extracted from install/setup.sh (from `_kosmos_off_why() {` to the
 * step after the pause) and run under `sh` with the shipped `set -euo pipefail`, so this pins
 * the SHIPPED text, as install.reachable-1662.test.js does for reachable(). A stub board on a
 * free port stands in for the other install's, or for this install's own (a node process
 * running <home>/app/server.js, which is what the pause's own-board check matches).
 * Every stub is stopped by its own child handle, never by a pattern or a group.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFile } = require('node:child_process');

const SETUP = fs.readFileSync(path.join(__dirname, 'install', 'setup.sh'), 'utf8');
const BLOCK = (() => {
  const lines = SETUP.split('\n');
  const a = lines.findIndex((l) => l.startsWith('_kosmos_off_why() {'));
  const b = lines.findIndex((l) => l.startsWith('step "Setting up the pieces Kosmos needs."'));
  return a >= 0 && b > a ? lines.slice(a, b).join('\n') : null;
})();

const HAVE_LSOF = (() => { try { require('node:child_process').execFileSync('/bin/sh', ['-c', 'command -v lsof'], { stdio: 'ignore' }); return true; } catch { return false; } })();

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}
/* A pid checked free (no such process), never 0 or negative: EPERM means it exists under another user. */
function freePid() {
  for (let p = 999999; p > 900000; p -= 1) {
    try { process.kill(p, 0); } catch (e) { if (e.code === 'ESRCH') return p; }
  }
  throw new Error('no free pid found between 900000 and 999999');
}
async function waitAnswering(port) {
  for (let i = 0; i < 50; i += 1) {
    const ok = await new Promise((resolve) => {
      const req = require('node:http').get({ host: '127.0.0.1', port, path: '/', timeout: 500 }, (res) => { res.resume(); resolve(true); });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('the stub board never answered on port ' + port);
}

/* Run the pause with `mode` and a stub board on the port: `own` = this install's board
   (board.pid names it), otherwise another install's (board.pid names a pid checked free). */
/* `stalePid`: this install's own board is the listener, but board.pid names a free pid (the pause's
   own-board check then misses it, the false negative the block's comment names). */
async function runPause({ mode, own, stalePid = false, stub: withStub = true, after = '' }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-4676-'));
  fs.mkdirSync(path.join(home, 'bin'));
  fs.mkdirSync(path.join(home, 'app'));
  fs.mkdirSync(path.join(home, 'logs'));
  fs.writeFileSync(path.join(home, 'bin', 'kosmos'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const port = await freePort();
  const serve = `require('http').createServer((q, r) => r.end('<title>Kosmos</title>')).listen(${port}, '127.0.0.1');`;
  let stub = null;
  if (!withStub) {
    fs.writeFileSync(path.join(home, 'board.pid'), '');
  } else if (own) {
    fs.writeFileSync(path.join(home, 'app', 'server.js'), serve);
    stub = spawn(process.execPath, [path.join(home, 'app', 'server.js')], { stdio: 'ignore' });
    fs.writeFileSync(path.join(home, 'board.pid'), String(stalePid ? freePid() : stub.pid));
  } else {
    stub = spawn(process.execPath, ['-e', serve], { stdio: 'ignore' });
    fs.writeFileSync(path.join(home, 'board.pid'), String(freePid()));
  }
  try {
    if (stub) await waitAnswering(port);
    const script = [
      'set -euo pipefail',
      'info() { echo "INFO: $*"; }',
      'die() { echo "DIE: $*"; exit 1; }',
      '_kosmos_mode_read() { _kosmos_mode_file=yes; _kosmos_mode_word="$MODE"; }',
      'KOSMOS_HOME="$1"; LOG_DIR="$1/logs"; FRESH_INSTALL=no; PORT="$2"; MODE="$3"',
      BLOCK,
      'echo "PASSED THE PAUSE"',
      after,
    ].join('\n');
    const got = await new Promise((resolve) => {
      execFile('sh', ['-c', script, 'sh', home, String(port), mode], { encoding: 'utf8', timeout: 40000 }, (err, stdout) => {
        resolve({ code: err ? (err.code ?? 1) : 0, out: stdout });
      });
    });
    return { ...got, home, port, abort: fs.existsSync(path.join(home, 'logs', 'update-abort')) };
  } finally {
    if (stub) stub.kill();
  }
}

test('#4676: the extraction found the shipped pause block', () => {
  assert.ok(BLOCK, 'the pause block could not be extracted from install/setup.sh, so this file measured nothing');
  assert.match(BLOCK, /so it is left alone/, 'the connect carve-out is inside the extracted block');
  assert.match(BLOCK, /GONE BY PORT/, 'the gone-by-port wait is inside the extracted block');
});

test('#4676: a connect computer updates past another install\'s board, and is never told to kill it', { skip: !HAVE_LSOF && 'no lsof here, so the gone-by-port wait never runs', timeout: 60000 }, async () => {
  const r = await runPause({ mode: 'connect', own: false });
  assert.match(r.out, /it is not this install's, and this install does not start a board here now, so it is left alone/, r.out);
  assert.doesNotMatch(r.out, /kill|still holding port/, r.out);
  assert.match(r.out, /PASSED THE PAUSE/, r.out);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.abort, false, 'a foreign board is not this install\'s board-would-not-pause streak');
});

test('#4676 CONTROL: a run computer still refuses with the #964 advice (its own start would collide)', { timeout: 60000 }, async () => {
  const r = await runPause({ mode: 'run', own: false });
  assert.match(r.out, /DIE: Another Kosmos is answering on port \d+, but this install's own board is not running/, r.out);
  assert.doesNotMatch(r.out, /PASSED THE PAUSE/, r.out);
});

test('#4676 CONTROL: a connect computer whose OWN board will not pause still stops the update (#2055)', { timeout: 60000 }, async () => {
  const r = await runPause({ mode: 'connect', own: true });
  assert.match(r.out, /DIE: A Kosmos board is still running on port \d+ and could not be paused/, r.out);
  assert.equal(r.abort, true, 'the #2055 streak is recorded for our own board');
});

/* The later start and restart points decide by `_kosmos_board_decide`. A person who picks "Run agents on
   this computer" DURING the update must not get a start against the other install's board: a busy one
   would meet the #3079 reclaim, which kills a same-user Kosmos listener. */
const FLIP = 'MODE=run; _kosmos_board_decide; echo "OFF=$_kosmos_board_off"; echo "WHY=$(_kosmos_off_why)"';

test('#4676: switched to run after the pause left another install\'s board: this run still starts nothing on that port, and says why', { skip: !HAVE_LSOF && 'no lsof here', timeout: 60000 }, async () => {
  const r = await runPause({ mode: 'connect', own: false, after: FLIP });
  assert.match(r.out, /PASSED THE PAUSE/, r.out);
  assert.match(r.out, /^OFF=yes$/m, r.out);
  assert.match(r.out, new RegExp('^WHY=while another Kosmos is using port ' + r.port + '$', 'm'), r.out);
});

test('#4676 CONTROL: switched to run with NO other board on the port, the board is started as chosen', { timeout: 60000 }, async () => {
  const r = await runPause({ mode: 'connect', own: false, stub: false, after: FLIP });
  assert.match(r.out, /PASSED THE PAUSE/, r.out);
  assert.match(r.out, /^OFF=no$/m, r.out);
});

test('#4676: a connect computer whose OWN board holds the port behind a stale board.pid still does not update under it', { skip: !HAVE_LSOF && 'no lsof here', timeout: 60000 }, async () => {
  const r = await runPause({ mode: 'connect', own: true, stalePid: true });
  // The pause's pid check misses our board, so the carve-out fires; the port wait must still see it by its command.
  assert.match(r.out, /so it is left alone/, r.out);
  assert.match(r.out, /DIE: A process is still holding port \d+ after the pause/, r.out);
  assert.doesNotMatch(r.out, /PASSED THE PAUSE/, r.out);
});
