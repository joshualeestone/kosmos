'use strict';
/**
 * kosmos#5358 (beta-day report, a Windows install): "the `kosmos` CLI is still not on PATH in an agent's own shell".
 * Kosmos's own launch path is meant to make it work in every shell an agent uses (engine/win32launch.childEnv puts
 * <zip>\bin first on PATH, and gives the PowerShell runners the process-scope policy, #3380). Until now that was
 * measured by hand on one box; these arms measure it on the Windows CI runner, so a red names which half broke:
 *   - Git Bash (Claude Code's Bash tool): a login shell finds `kosmos` on the agent's PATH;
 *   - Claude Code's PowerShell tool, with the flags it passes itself (measured in #570): runs kosmos.ps1 under a
 *     Restricted policy;
 *   - Codex's `powershell -Command`: refused under Restricted WITHOUT the variable (the control), runs WITH it.
 * Plus pure arms (any OS) for the one fix this card makes: the policy variable is ONE key whatever case it arrives in.
 *
 * Windows arms use a zip-shaped folder with the real shims and a stub CLI. The policy arms change the CurrentUser
 * policy, so they run only on GitHub Actions and put it back.
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

test('#5358: a PowerShell runner\'s policy is ONE key whatever case it arrives in; claude gets none (#3380)', () => {
  for (const runner of ['codex', 'gemini', 'grok', 'antigravity']) {
    const env = launcher.childEnv({ psexecutionpolicypreference: 'AllSigned' }, 't', null, 'C:\\K\\bin', runner);
    assert.deepEqual(keysOf(env, 'PSExecutionPolicyPreference'), ['psexecutionpolicypreference'], runner + ': two keys');
    assert.equal(env.psexecutionpolicypreference, 'Bypass', runner);
    assert.equal(launcher.childEnv({}, 't', null, 'C:\\K\\bin', runner).PSExecutionPolicyPreference, 'Bypass', runner + ' (no key before)');
  }
  assert.deepEqual(keysOf(launcher.childEnv({}, 't', null, 'C:\\K\\bin', 'claude'), 'PSExecutionPolicyPreference'), [],
    'control: a claude child is left as #3380 decided (its PowerShell tool passes its own policy flag)');
});

/* ---------- Windows only: the shells themselves ---------- */

const onWindows = process.platform === 'win32';
const onCi = process.env.GITHUB_ACTIONS === 'true';
const SYSROOT = process.env.SystemRoot || 'C:\\Windows';
const POWERSHELL = path.join(SYSROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const GIT_BASH = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'].find((p) => fs.existsSync(p));
const STUB = /KOSMOS-STUB \["--version"\]/;

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

/* The runner's own environment with no policy variable in it, so every arm's policy is the one it states. */
function baseEnv() {
  const env = { ...process.env };
  for (const k of keysOf(env, 'PSExecutionPolicyPreference')) delete env[k];
  return env;
}
const agentEnv = (bin, runner) => launcher.childEnv(baseEnv(), null, null, bin, runner);
const run = (cmd, args, env) => spawnSync(cmd, args, { env, encoding: 'utf8', timeout: 30000 });
const said = (r) => 'status ' + r.status + '\nstdout ' + r.stdout + '\nstderr ' + r.stderr;

test('#5358 Windows: in a Git Bash login shell (Claude Code\'s Bash tool), a bare kosmos is found on the agent\'s PATH',
  { skip: !onWindows ? 'Windows only' : !GIT_BASH ? 'no Git Bash on this machine' : false }, () => {
    const z = stageZip();
    try {
      const r = run(GIT_BASH, ['-lc', 'kosmos --version'], agentEnv(z.bin, 'claude'));
      assert.match(String(r.stdout), STUB, said(r));
      const none = run(GIT_BASH, ['-lc', 'kosmos --version'], baseEnv());
      assert.doesNotMatch(String(none.stdout), STUB, 'control: kosmos was found without the agent\'s PATH');
    } finally { fs.rmSync(z.root, { recursive: true, force: true }); }
  });

test('#5358 Windows: under a Restricted policy, Claude Code\'s PowerShell runs kosmos; codex\'s needs the agent\'s variable',
  // Its own timeout: several PowerShell starts, past the runner script's 60 s per test default.
  { timeout: 240000, skip: !onWindows ? 'Windows only' : !onCi ? 'changes the CurrentUser script policy, so only on GitHub Actions' : false }, () => {
    const z = stageZip();
    const ps = (env, command, flags = []) => run(POWERSHELL, ['-NoProfile', '-NonInteractive', ...flags, '-Command', command], env);
    const was = String(ps(baseEnv(), 'Get-ExecutionPolicy -Scope CurrentUser').stdout || '').trim() || 'Undefined';
    try {
      const set = ps(baseEnv(), 'Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy Restricted -Force');
      assert.equal(set.status, 0, 'could not set the CurrentUser policy: ' + set.stderr);
      assert.equal(String(ps(baseEnv(), 'Get-ExecutionPolicy').stdout || '').trim(), 'Restricted',
        'control: this runner\'s effective policy is not Restricted (a higher scope sets it), so no arm here can show a refusal');
      // Claude Code's PowerShell tool, as measured in #570: it passes its own process-scope policy.
      const claude = ps(agentEnv(z.bin, 'claude'), 'kosmos --version', ['-ExecutionPolicy', 'Bypass']);
      assert.match(String(claude.stdout), STUB, 'Claude Code\'s PowerShell: ' + said(claude));
      // Codex's `powershell -Command`, without and with what childEnv gives a codex agent.
      const bare = { ...agentEnv(z.bin, 'codex') };
      for (const k of keysOf(bare, 'PSExecutionPolicyPreference')) delete bare[k];
      const refused = ps(bare, 'kosmos --version');
      assert.doesNotMatch(String(refused.stdout), STUB, 'control: a Restricted policy did not stop kosmos.ps1');
      assert.match(String(refused.stderr) + String(refused.stdout), /scripts is disabled|cannot be loaded/i, 'control: refused for another reason: ' + said(refused));
      const codex = agentEnv(z.bin, 'codex');
      assert.equal(codex.PSExecutionPolicyPreference, 'Bypass', 'the policy must come from childEnv (baseEnv carries none)');
      const ran = ps(codex, 'kosmos --version');
      assert.match(String(ran.stdout), STUB, 'codex\'s PowerShell with the agent\'s variable: ' + said(ran));
    } finally {
      ps(baseEnv(), 'Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy ' + (/^[A-Za-z]+$/.test(was) ? was : 'Undefined') + ' -Force');
      fs.rmSync(z.root, { recursive: true, force: true });
    }
  });
