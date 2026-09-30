'use strict';
/**
 * #4669: a board that `kosmos start` launches must outlive the launchd job that ran it.
 *
 * When a launchd job ends, launchd kills every process left in the job's process group, and `nohup ... &`
 * does not leave it. On Mortals (2026-09-29) the watchdog's recovery `kosmos start` brought a board up and
 * it died 745 ms later, when the watchdog job exited, so the board stayed down until a person started it.
 *
 * This runs the REAL CLI's unsupervised (nohup) start in a throwaway KOSMOS_HOME with a stub board, as
 * the leader of its own process group (as launchd runs a job), then does what launchd does at job exit:
 * SIGKILL every process still in that group. The pids are listed and checked one by one first; nothing
 * here signals a negative pid or a whole user (the 19:27 mass kill on Mortals was a kill(-1)).
 *
 * CONTROL: the same run against a copy of the CLI without the fix must see the board die, so a pass
 * cannot come from a harness that never kills anything.
 *
 * Never touches this Mac's launchd: AGENT_WORKFORCE_LAUNCH makes the board read as unsupervised.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const FIX = 'set -m\n';

async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}

/** A throwaway install: the real node as the runtime, a stub board that answers /api/health as Kosmos. */
function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-4669-home-'));
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  fs.mkdirSync(path.join(home, 'app'), { recursive: true });
  fs.writeFileSync(path.join(home, 'app', 'server.js'), `
require('node:http').createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ app: 'kosmos', ok: true }));
}).listen(Number(process.env.PORT), '127.0.0.1');
`);
  fs.mkdirSync(path.join(home, 'tmux', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, 'tmux', 'bin', 'tmux'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return home;
}

function env(home, port) {
  const e = { ...process.env };
  delete e.KOSMOS_AGENT_TOKEN; delete e.KOSMOS_AGENT_SESSION; delete e.TMUX_PANE; delete e.KOSMOS_RECLAIM_BUSY;
  return {
    ...e,
    KOSMOS_HOME: home, KOSMOS_PORT: String(port), KOSMOS_NO_LEGACY_MIGRATION: '1',
    AGENT_WORKFORCE_LAUNCH: path.join(home, 'launch'), AGENT_WORKFORCE_DATA: path.join(home, 'data'),
    AGENT_WORKFORCE_WORKERS: path.join(home, 'workers'), AGENT_WORKFORCE_PROJECTS: path.join(home, 'projects'),
  };
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** Every pid whose process group is `pgid`, read from ps. */
function groupMembers(pgid) {
  const out = execFileSync('/bin/ps', ['-A', '-o', 'pid=,pgid='], { encoding: 'utf8' });
  return out.split('\n').map((l) => l.trim().split(/\s+/).map(Number))
    .filter(([pid, g]) => Number.isInteger(pid) && pid > 1 && g === pgid).map(([pid]) => pid);
}

async function answers(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
    return r.status === 200;
  } catch { return false; }
}

/** Start the board with `cli` as a launchd job would, end the job the way launchd does, report what is left. */
async function startThenEndTheJob(cli) {
  const home = makeHome();
  const port = await freePort();
  let boardPid = 0;
  try {
    // detached: the CLI leads a new process group (pgid = its pid), as a launchd job's process does.
    const job = spawn('/bin/bash', [cli, 'start'], { env: env(home, port), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const pgid = job.pid;
    let said = '';
    job.stdout.on('data', (d) => { said += d; });
    job.stderr.on('data', (d) => { said += d; });
    const code = await new Promise((r) => job.on('exit', (c) => r(c)));
    assert.equal(code, 0, 'kosmos start must succeed in the sandbox: ' + said);
    boardPid = Number(fs.readFileSync(path.join(home, 'board.pid'), 'utf8'));
    assert.ok(boardPid > 1 && alive(boardPid), 'the pidfile names a live board: ' + boardPid);
    assert.ok(await answers(port), 'the board answers before the job ends');

    // The job has exited. launchd now kills what is left in its process group. List it, check each pid
    // is not this test or its parent, and signal exactly those pids.
    const left = groupMembers(pgid);
    for (const pid of left) assert.ok(pid !== process.pid && pid !== process.ppid, 'refusing to signal the test itself: ' + pid);
    for (const pid of left) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
    await new Promise((r) => setTimeout(r, 300));
    return { inGroup: left.includes(boardPid), alive: alive(boardPid), answers: await answers(port) };
  } finally {
    if (boardPid > 1 && alive(boardPid)) { try { process.kill(boardPid, 'SIGKILL'); } catch { /* gone */ } }
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('#4669 a board started by `kosmos start` survives the end of the launchd job that ran it', async () => {
  const r = await startThenEndTheJob(CLI);
  assert.equal(r.inGroup, false, 'the board must not be in the job\'s process group');
  assert.equal(r.alive, true, 'the board must still be running after the job\'s group is killed');
  assert.equal(r.answers, true, 'and still answering');
});

test('#4669 CONTROL: without the fix, ending the job takes the board down (the harness can see the failure)', async () => {
  const src = fs.readFileSync(CLI, 'utf8');
  const lines = src.split('\n');
  const launch = lines.findIndex((l) => /nohup "\$NODE" "\$APP"/.test(l));
  assert.ok(launch > 0 && lines[launch - 1].trim() === FIX.trim() && lines[launch + 1].trim() === 'set +m',
    'the nohup launch is wrapped in set -m / set +m');
  lines.splice(launch + 1, 1); lines.splice(launch - 1, 1);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-4669-cli-'));
  const old = path.join(dir, 'kosmos');
  fs.writeFileSync(old, lines.join('\n'), { mode: 0o755 });
  try {
    const r = await startThenEndTheJob(old);
    assert.equal(r.inGroup, true, 'without set -m the board shares the job\'s process group');
    assert.equal(r.alive, false, 'and dies with it, as it did on Mortals');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
