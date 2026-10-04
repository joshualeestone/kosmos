'use strict';
/**
 * #4679: kosmos start's #3079 reclaim must never kill another install's board by the same user.
 *
 * When two installs by the same user share a port and one of them is busy or silent,
 * a start under KOSMOS_RECLAIM_BUSY=1 (installer update, or watchdog recovery) must refuse
 * with actionable advice and leave the other install's board running.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');

const DATA4796 = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-reclaim-4679-'));
test.after(() => { try { fs.rmSync(DATA4796, { recursive: true, force: true }); } catch {} });

const CLI = path.join(__dirname, 'install', 'kosmos');

async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}

function makeHome(prefix) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  fs.mkdirSync(path.join(home, 'app'), { recursive: true });
  fs.mkdirSync(path.join(home, 'tmux', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, 'tmux', 'bin', 'tmux'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return home;
}

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    execFile(CLI, args, { env, timeout: 40000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '): killed by the harness timeout, over the output buffer, or never started. ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

test('#4679: a start under KOSMOS_RECLAIM_BUSY=1 refuses and does not kill another install board', async () => {
  const port = await freePort();
  const homeThis = makeHome('kosmos-this-4679-');
  const homeOther = makeHome('kosmos-other-4679-');
  test.after(() => {
    try { fs.rmSync(homeThis, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(homeOther, { recursive: true, force: true }); } catch {}
  });

  const stubServer = path.join(homeOther, 'app', 'server.js');
  fs.writeFileSync(stubServer, `
const net = require('node:net');
const s = net.createServer((c) => { /* accept and hold */ });
s.listen(${port}, '127.0.0.1');
setTimeout(() => {}, 60000);
`);

  // exit code not read (#3628): stub background process for other install
  const stubProcess = spawn(process.execPath, [stubServer], { stdio: 'ignore' });
  test.after(() => { try { stubProcess.kill('SIGKILL'); } catch {} });

  // Wait for the stub to listen
  let listening = false;
  for (let i = 0; i < 40; i++) {
    const ok = await new Promise((res) => {
      const sock = net.connect(port, '127.0.0.1', () => { sock.destroy(); res(true); });
      sock.on('error', () => res(false));
    });
    if (ok) { listening = true; break; }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(listening, true, 'stub server must be listening on port');

  const baseEnv = {
    ...process.env,
    AGENT_WORKFORCE_DATA: DATA4796,
    KOSMOS_HOME: homeThis,
    KOSMOS_PORT: String(port),
    KOSMOS_RECLAIM_BUSY: '1',
    KOSMOS_BUSY_WAIT: '2',
    KOSMOS_LAUNCHCTL: '/usr/bin/false',
    AGENT_WORKFORCE_LAUNCH: 'nohup',
  };
  delete baseEnv.KOSMOS_AGENT_TOKEN;
  delete baseEnv.KOSMOS_AGENT_SESSION;
  delete baseEnv.TMUX_PANE;

  const res = await runCli(['start'], baseEnv);
  assert.notEqual(res.code, 0, 'start must refuse when port held by another install');
  const combined = res.stdout + res.stderr;
  assert.match(combined, /Another Kosmos install of yours on this computer is already using port/, 'must advise about other install');
  assert.match(combined, /Quit that board, or set KOSMOS_PORT to a different number/, 'must provide KOSMOS_PORT advice');

  // Verify stub process is still alive and was NOT killed
  let alive = false;
  try {
    process.kill(stubProcess.pid, 0);
    alive = true;
  } catch {}
  assert.equal(alive, true, 'stub process from other install must still be alive');

  // Verify status reports busy (exit 4) for non-answering board
  const statusRes = await runCli(['status'], {
    ...baseEnv,
    KOSMOS_BUSY_WAIT: '2',
  });
  assert.equal(statusRes.code, 4, 'status must exit 4 (busy) for non-answering board');
  assert.match(statusRes.stdout + statusRes.stderr, /is running at .* but is busy/, 'status reports busy');
});
