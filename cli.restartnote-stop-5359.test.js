'use strict';
/**
 * #5359 review 2: `kosmos stop` removes the board's last-alive record (engine/restartnote.js) only once the board is
 * gone. Before the kill, the board's once-a-minute beat could write it back; and a stop that failed must not erase the
 * record of a board that is still running. The CLI is sourced, as cli.busy-health-4466.test.js does, so each arm runs
 * the real cmd_stop with only its probes replaced.
 *
 *   node --test cli.restartnote-stop-5359.test.js
 */
require('./test-support/tmpscope');   // #4273: first, so every temp dir this file makes is contained and removed
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-restartnote-stop-5359-'));
process.on('exit', () => { try { fs.rmSync(SCRATCH, { recursive: true, force: true }); } catch { /* best effort */ } });

function env(extra = {}) {
  const e = { ...process.env };
  delete e.KOSMOS_AGENT_TOKEN; delete e.KOSMOS_AGENT_SESSION; delete e.TMUX_PANE;
  return {
    ...e,
    KOSMOS_PORT: '1', KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_HOME: path.join(SCRATCH, 'home'),
    AGENT_WORKFORCE_DATA: path.join(SCRATCH, 'data'), AGENT_WORKFORCE_WORKERS: path.join(SCRATCH, 'workers'),
    AGENT_WORKFORCE_LAUNCH: path.join(SCRATCH, 'launch'), AGENT_WORKFORCE_PROJECTS: path.join(SCRATCH, 'projects'),
    ...extra,
  };
}

function bash(script, e) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-c', script], { env: e, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const t = setTimeout(() => child.kill('SIGKILL'), 30000);
    child.on('close', (code, sig) => {
      clearTimeout(t);
      const r = { code, out };
      /* #3628: a killed run has no exit code; it must fail the test, never read as one. */
      if (typeof r.code !== 'number') { reject(new Error('bash gave no exit code (' + sig + '): killed by the 30s limit. ' + out)); return; }
      resolve(r);
    });
  });
}

/* Replaces cmd_stop's probes: the board is the given pid, it does not answer on the port, nothing supervises it. The
   clear itself is replaced by a line saying whether the board was still alive when it ran. */
const PROBES = (pid) => `running_pid() { echo ${pid}; }; healthy() { HEALTH_STATE=down; return 1; }; _kosmos_board_supervised() { return 1; }
_kosmos_clear_board_alive() { if kill -0 ${pid} 2>/dev/null; then echo CLEARED-WHILE-ALIVE; else echo CLEARED-AFTER-DEATH; fi; }`;

test('#5359: kosmos stop clears the last-alive record only after the board is gone', async () => {
  fs.mkdirSync(path.join(SCRATCH, 'home'), { recursive: true });
  // exit code not read (#3628): this is the stand-in BOARD, not the CLI under test; node reaps it, so kill -0 sees it go.
  const board = spawn('sleep', ['60'], { stdio: 'ignore' });
  try {
    const r = await bash(`source "${CLI}"; ${PROBES(board.pid)}; cmd_stop`, env());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Stopped\./);
    assert.match(r.out, /CLEARED-AFTER-DEATH/, 'the clear did not run, or ran while the board was alive:\n' + r.out);
    assert.doesNotMatch(r.out, /CLEARED-WHILE-ALIVE/);
  } finally { try { board.kill('SIGKILL'); } catch { /* gone */ } }
});

test('#5359: a stop that failed keeps the last-alive record of the board still running', async () => {
  fs.mkdirSync(path.join(SCRATCH, 'home'), { recursive: true });
  // exit code not read (#3628): the stand-in BOARD again, which this arm keeps alive.
  const board = spawn('sleep', ['60'], { stdio: 'ignore' });
  try {
    // kill is replaced so the board survives the stop: the "Could not stop it" path.
    const r = await bash(`source "${CLI}"; ${PROBES(board.pid)}; kill() { [ "$1" = -0 ] && command kill "$@"; return 0; }; ( cmd_stop ) || echo "rc=$?"`, env());
    assert.match(r.out, /Could not stop it/, r.out);
    assert.match(r.out, /rc=1/);
    assert.doesNotMatch(r.out, /CLEARED-/, 'a failed stop cleared the record:\n' + r.out);
  } finally { try { board.kill('SIGKILL'); } catch { /* gone */ } }
});

test('#5359: the clear removes board-alive.json from the data root the board writes, and nothing else there', async () => {
  // KOSMOS_HOME is this checkout, so the clear finds engine/store.js; nothing in this arm writes under it.
  const e = env({ KOSMOS_HOME: __dirname, AGENT_WORKFORCE_DATA: path.join(SCRATCH, 'data-clear') });
  const root = (await bash(`node -e 'process.stdout.write(require(process.argv[1]).ROOT)' "${path.join(__dirname, 'engine', 'store.js')}"`, e)).out;
  assert.ok(root.startsWith(SCRATCH), 'the data root is not this test\'s: ' + root);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'board-alive.json'), '{"at":"2026-10-06T00:00:00.000Z"}\n');
  fs.writeFileSync(path.join(root, 'board-restart-note.json'), '{}\n');
  const r = await bash(`source "${CLI}"; _kosmos_clear_board_alive; echo "rc=$?"`, e);
  assert.match(r.out, /rc=0/, r.out);
  assert.equal(fs.existsSync(path.join(root, 'board-alive.json')), false, 'the record is still there');
  assert.equal(fs.existsSync(path.join(root, 'board-restart-note.json')), true, 'a sibling file was removed');
});
