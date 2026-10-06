'use strict';
/**
 * kosmos#5358 (beta-day report, a Windows install): "the `kosmos` CLI is still not on PATH in an agent's own shell".
 * The same report says scripts were refused ("running scripts is disabled") after a policy reset, and in PowerShell
 * a bare `kosmos` IS kosmos.ps1, so a Restricted policy makes the command look missing. engine/win32launch.childEnv
 * now gives a Kosmos-launched agent the process-scope policy PowerShell reads from PSExecutionPolicyPreference.
 *
 * The first tests are pure (any OS). The shell arms run only on Windows (tools/windows-tests.js selects this file by
 * its name): a zip-shaped folder with the real shims and a stub CLI, the agent's env from the real childEnv, and a
 * bare `kosmos` typed in PowerShell and in a Git Bash login shell. The policy arms change the CurrentUser policy, so
 * they run only on GitHub Actions and put it back.
 *
 *   node --test engine/win32-kosmos-shell-5358.test.js
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const launcher = require('./win32launch');

const keysOf = (env, name) => Object.keys(env).filter((k) => k.toUpperCase() === name.toUpperCase());

test('#5358: an agent given the kosmos CLI gets PowerShell\'s process-scope policy; one without it does not', () => {
  const env = launcher.childEnv({ Path: 'C:\\Windows' }, 't', null, 'C:\\K\\bin', 'claude');
  assert.equal(env.PSExecutionPolicyPreference, 'Bypass');
  assert.equal(env.Path, 'C:\\K\\bin;C:\\Windows', 'control: the CLI folder is first on the one PATH key');
  const none = launcher.childEnv({ Path: 'C:\\Windows' }, 't', null, null, 'claude');
  assert.deepEqual(keysOf(none, 'PSExecutionPolicyPreference'), [], 'an agent with no CLI folder was given a policy');
});

test('#5358: a policy the environment already sets is kept, whatever the spelling of its name, and never doubled', () => {
  const env = launcher.childEnv({ psexecutionpolicypreference: 'AllSigned' }, 't', null, 'C:\\K\\bin', 'claude');
  assert.deepEqual(keysOf(env, 'PSExecutionPolicyPreference'), ['psexecutionpolicypreference']);
  assert.equal(env.psexecutionpolicypreference, 'AllSigned');
});

/* ---------- Windows only: the shells themselves ---------- */

const onWindows = process.platform === 'win32';
const onCi = process.env.GITHUB_ACTIONS === 'true';
const SYSROOT = process.env.SystemRoot || 'C:\\Windows';
const POWERSHELL = path.join(SYSROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const GIT_BASH = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'].find((p) => fs.existsSync(p));

/* A zip-shaped folder: bin\ with the real shims and a stub kosmos-cli.js, runtime\node.exe. */
function stageZip() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'k5358-'));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(root, 'runtime'));
  const repo = path.join(__dirname, '..');
  fs.copyFileSync(path.join(repo, 'tools', 'windows', 'kosmos.ps1'), path.join(bin, 'kosmos.ps1'));
  fs.writeFileSync(path.join(bin, 'kosmos'), fs.readFileSync(path.join(repo, 'tools', 'windows', 'kosmos.sh'), 'utf8').replace(/\r/g, ''));
  // The stub answers with its arguments, read the way kosmos-cli.js reads them (the ps1 shim sends a JSON file).
  fs.writeFileSync(path.join(bin, 'kosmos-cli.js'), [
    "const a = process.argv.slice(2);",
    "const i = a.indexOf('--kosmos-argv-file');",
    "const words = i === -1 ? a : JSON.parse(require('fs').readFileSync(a[i + 1], 'utf8'));",
    "console.log('KOSMOS-STUB ' + JSON.stringify(words));",
  ].join('\n'));
  try { fs.linkSync(process.execPath, path.join(root, 'runtime', 'node.exe')); }
  catch { fs.copyFileSync(process.execPath, path.join(root, 'runtime', 'node.exe')); }
  return { root, bin };
}

function agentEnv(bin, keepPolicy) {
  const env = launcher.childEnv(process.env, null, null, bin, 'claude');
  if (!keepPolicy) for (const k of keysOf(env, 'PSExecutionPolicyPreference')) delete env[k];
  return env;
}

function powershell(env, command) {
  return spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', command], { env, encoding: 'utf8', timeout: 45000 });
}

test('#5358 Windows: in a Git Bash login shell (Claude Code\'s), a bare kosmos is found on the agent\'s PATH', { skip: !onWindows ? 'Windows only' : !GIT_BASH ? 'no Git Bash on this machine' : false }, () => {
  const z = stageZip();
  try {
    const r = spawnSync(GIT_BASH, ['-lc', 'kosmos --version'], { env: agentEnv(z.bin, true), encoding: 'utf8', timeout: 45000 });
    assert.match(String(r.stdout), /KOSMOS-STUB \["--version"\]/, 'status ' + r.status + '\nstdout ' + r.stdout + '\nstderr ' + r.stderr);
  } finally { fs.rmSync(z.root, { recursive: true, force: true }); }
});

test('#5358 Windows: under a Restricted policy, a bare kosmos in PowerShell is refused without the agent\'s policy and runs with it',
  { skip: !onWindows ? 'Windows only' : !onCi ? 'changes the CurrentUser script policy, so only on GitHub Actions' : false }, () => {
    const z = stageZip();
    const was = String(powershell(process.env, 'Get-ExecutionPolicy -Scope CurrentUser').stdout || '').trim() || 'Undefined';
    try {
      const set = powershell(process.env, 'Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy Restricted -Force');
      assert.equal(set.status, 0, 'could not set the CurrentUser policy: ' + set.stderr);
      const eff = String(powershell(agentEnv(z.bin, false), 'Get-ExecutionPolicy').stdout || '').trim();
      assert.equal(eff, 'Restricted', 'control: this runner\'s effective policy is not Restricted (a higher scope sets it), so the test cannot show the defect');
      const before = powershell(agentEnv(z.bin, false), 'kosmos --version');
      assert.doesNotMatch(String(before.stdout), /KOSMOS-STUB/, 'control: a Restricted policy did not stop kosmos.ps1, so this test cannot see the defect');
      assert.match(String(before.stderr) + String(before.stdout), /scripts is disabled|cannot be loaded/i, 'control: refused for another reason: ' + before.stderr);
      const after = powershell(agentEnv(z.bin, true), 'kosmos --version');
      assert.match(String(after.stdout), /KOSMOS-STUB \["--version"\]/, 'with the agent\'s policy: status ' + after.status + '\nstderr ' + after.stderr);
    } finally {
      powershell(process.env, 'Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy ' + (/^[A-Za-z]+$/.test(was) ? was : 'Undefined') + ' -Force');
      fs.rmSync(z.root, { recursive: true, force: true });
    }
  });
