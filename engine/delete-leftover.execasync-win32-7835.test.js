'use strict';
/**
 * kosmos#7835: the async runner the Windows drive probe and Recycle Bin move go through, driven against the real
 * Windows PowerShell. Every other #7835 test stubs PowerShell, so only this file shows that a real run answers: its
 * output, a non-zero exit read as a failure, and a process past its limit killed and answered with no exit code.
 * "win32" in the name puts it in tools/windows-tests.js's run on the Windows runner; elsewhere it skips.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'delete-leftover-exec-7835-'));
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = nodePath.join(SANDBOX, 'LaunchAgents', 'systemd', 'user');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_TRASH = nodePath.join(SANDBOX, 'Trash');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const leftover = require('./delete-leftover');

const onWindows = process.platform === 'win32';
const PS = ['-NoProfile', '-NonInteractive', '-Command'];

test('#7835 a real PowerShell run answers with its output, and a non-zero exit is a failure', { skip: !onWindows && 'Windows PowerShell only' }, async () => {
  const said = await leftover.execAsync('powershell.exe', [...PS, "'kosmos-7835'"], { timeout: 60000 });
  assert.equal(said.ok, true, JSON.stringify(said));
  assert.match(String(said.stdout), /kosmos-7835/);
  const bad = await leftover.execAsync('powershell.exe', [...PS, 'exit 3'], { timeout: 60000 });
  assert.equal(bad.ok, false, JSON.stringify(bad));
  assert.equal(bad.code, 3, 'the exit code was not carried');
});

test('#7835 a real PowerShell past its limit is killed and answered, with no exit code', { skip: !onWindows && 'Windows PowerShell only' }, async () => {
  const t0 = Date.now();
  const slow = await leftover.execAsync('powershell.exe', [...PS, 'Start-Sleep -Seconds 30'], { timeout: 1500 });
  assert.equal(slow.ok, false, JSON.stringify(slow));
  assert.equal(slow.code, null, 'a process killed at its limit carried an exit code');
  assert.ok(Date.now() - t0 < 20000, `it was not killed at its limit (${Date.now() - t0} ms)`);
});
