'use strict';
/* kosmos#6213: the one part of the Windows status line wiring that only Windows can run: the 8.3 short name lookup
   (cmd.exe's %~sI). Everywhere else the rule is tested with the lookup stood in (engine/allowance.test.js); here the
   real one runs on a folder with a space. Runs on the Windows CI job (tools/windows-tests.js picks it by the win32 in its name); skipped elsewhere. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const allowance = require('./allowance');

test('#6213 on Windows, a folder with a space gets a short name the command can carry', { skip: process.platform !== 'win32' && 'Windows only: the short name lookup is cmd.exe' }, () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos 6213 '));
  try {
    const script = path.join(base, 'kosmos-statusline.js');
    fs.writeFileSync(script, '');
    const cmd = allowance.winCommandFor(process.execPath, script, base);
    assert.ok(cmd, 'no command: the short name lookup gave nothing for ' + base + ' (a red here can also mean 8.3 names are switched off on this runner\'s drive, not that Kosmos is wrong)');
    assert.ok(!/["\\\s]/.test(cmd.replace(/ /g, '')), 'a quote, a backslash or a space went into a path: ' + cmd);
    assert.equal(cmd.split(' ').length, 3, 'not three unquoted paths: ' + cmd);
    assert.ok(cmd.includes('/kosmos-statusline.js'), 'the script name was shortened: ' + cmd);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

/* The plan's merge gate, measured where it can be: the command as Kosmos writes it, run the way Claude Code runs a status
   line on Windows (Git Bash when installed, else PowerShell), with a status line payload on stdin. A reading file must
   appear each time: that proves the shell runs the unquoted command AND that the piped JSON reaches node. Each shell
   that is not on this runner is skipped by name. Git Bash is found by its install path: a bare `bash` on Windows can be
   the WSL launcher. */
const { spawnSync } = require('node:child_process');
const statusline = require('./kosmos-statusline');
const SHELLS = [
  ['git bash', 'C:\\Program Files\\Git\\bin\\bash.exe', (c) => ['-c', c]],
  ['windows powershell', 'powershell.exe', (c) => ['-NoProfile', '-Command', c]],
  ['pwsh', 'pwsh.exe', (c) => ['-NoProfile', '-Command', c]],
];
for (const [label, exe, argsFor] of SHELLS) {
  const here = process.platform === 'win32' && (exe.includes('\\') ? fs.existsSync(exe) : spawnSync('where', [exe]).status === 0);
  test('#6213 the status line command runs in ' + label + ' and gets its JSON on stdin', { skip: !here && (process.platform === 'win32' ? label + ' is not on this runner' : 'Windows only') }, () => {
    const acct = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos6213acct'));
    try {
      const cmd = allowance.winCommandFor(process.execPath, path.join(__dirname, 'kosmos-statusline.js'), acct);
      assert.ok(cmd, 'no command for this runner\'s paths');
      const resets = Math.floor(Date.now() / 1000) + 3 * 86400;
      const input = JSON.stringify({ rate_limits: { seven_day: { used_percentage: 37, resets_at: resets } } });
      const r = spawnSync(exe, argsFor(cmd), { input, encoding: 'utf8', timeout: 30000 });
      const file = path.join(acct, statusline.FILE);
      assert.ok(fs.existsSync(file), label + ' ran the command but no reading was written (stdin did not arrive, or the command did not run). status ' + r.status + ', stderr: ' + String(r.stderr).slice(0, 400));
      assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).usedPct, 37);
    } finally { fs.rmSync(acct, { recursive: true, force: true }); }
  });
}
